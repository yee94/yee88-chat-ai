// src/chat/bot.ts - Bot 定义，连接 chat SDK 和 OpenCode Runner
import { Chat, type Thread, type Message, type SentMessage } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { consola } from "consola";
import { MemoryStateAdapter } from "./state.ts";
import { OpenCodeRunner } from "../runner/opencode.ts";
import { SessionStore } from "../session/store.ts";
import { ThreadScheduler, type ThreadJob } from "../scheduler/index.ts";
import { formatElapsed, formatHeader, assembleMarkdownParts, prepareMultiMessage } from "../markdown/index.ts";
import { TopicStateStore, type RunContext } from "../topic/state.ts";
import { mergeTopicContext, formatContext } from "../topic/context.ts";
import type { Yee88Event, ResumeToken } from "../model.ts";
import { type AppConfig, projectForChat, resolveProject } from "../config/index.ts";
import { isAuthorized, unauthorizedMessage } from "./guard.ts";

/** Bot 线程状态 */
interface BotThreadState {
  projectAlias?: string;
  engineOverride?: string;
}

/** 创建 Bot 实例 */
export function createBot(config: AppConfig) {
  const botToken = config.telegram?.bot_token;
  if (!botToken) {
    throw new Error("Missing telegram.bot_token in config");
  }

  const stateAdapter = new MemoryStateAdapter();
  const runner = new OpenCodeRunner({ model: undefined });
  const sessionStore = new SessionStore(
    `${process.env["HOME"]}/.yee88/sessions.json`
  );
  const topicStore = new TopicStateStore(
    `${process.env["HOME"]}/.yee88/topics.json`
  );

  const chat = new Chat<{ telegram: ReturnType<typeof createTelegramAdapter> }, BotThreadState>({
    userName: "yee88",
    adapters: {
      telegram: createTelegramAdapter({ botToken }),
    },
    state: stateAdapter,
    logger: "info",
  });

  /** 从 thread.id 解析出 topic 的 messageThreadId（如果有） */
  function parseTopicId(thread: Thread<BotThreadState>): string | null {
    // chat SDK telegram adapter 编码格式："telegram:{chatId}" 或 "telegram:{chatId}:{messageThreadId}"
    const parts = thread.id.split(":");
    return parts.length >= 3 ? parts[2]! : null;
  }

  /** 获取 session resume token，topic 优先，fallback 到 chat 级别 */
  function getResume(
    chatId: string,
    ownerId: string,
    topicThreadId: string | null
  ): ResumeToken | null {
    // Topic 级别 session 隔离
    if (topicThreadId) {
      const topicResume = topicStore.getSessionResume(chatId, topicThreadId, "opencode");
      if (topicResume) {
        return { engine: "opencode", value: topicResume };
      }
    }
    // Fallback 到 chat 级别
    return sessionStore.getSessionResume(chatId, ownerId, "opencode");
  }

  /** 保存 session resume token，同时写入 topic 和 chat 级别 */
  function saveResume(
    chatId: string,
    ownerId: string,
    topicThreadId: string | null,
    token: ResumeToken
  ): void {
    if (topicThreadId) {
      topicStore.setSessionResume(chatId, topicThreadId, token.engine, token.value);
    }
    sessionStore.setSessionResume(chatId, ownerId, token);
  }

  /** 流式进度消息的最大文本预览长度 */
  const MAX_STREAMING_TEXT = 2000;
  /** 流式更新间隔（毫秒） */
  const STREAM_UPDATE_INTERVAL = 1500;
  /** 文本变化时的最小更新间隔（毫秒） */
  const TEXT_UPDATE_INTERVAL = 800;

  /** 构建流式进度消息内容 */
  function buildProgressMarkdown(
    elapsed: number,
    actionLines: string[],
    streamingText: string | null,
    label = "▸"
  ): string {
    const header = formatHeader(elapsed, null, { label, engine: "opencode" });
    const parts: string[] = [header];

    if (streamingText) {
      const text = streamingText.length > MAX_STREAMING_TEXT
        ? streamingText.slice(streamingText.length - MAX_STREAMING_TEXT)
        : streamingText;
      parts.push(text + " ▍");
    }

    if (actionLines.length > 0) {
      parts.push(actionLines.join("\n"));
    }

    return parts.join("\n\n");
  }

  // 消息处理核心逻辑
  async function handleMessage(thread: Thread<BotThreadState>, message: Message): Promise<void> {
    const text = message.text.trim();
    if (!text) return;

    // 权限验证
    if (!isAuthorized(message, config)) {
      consola.warn(`[bot] unauthorized user: ${message.author.userId} (${message.author.userName})`);
      await thread.post(unauthorizedMessage());
      return;
    }

    const chatId = thread.channelId;
    const ownerId = message.author.userId;
    const topicThreadId = parseTopicId(thread);

    // 解析 topic context → 合并 chat 默认项目
    const boundContext = topicThreadId
      ? topicStore.getContext(chatId, topicThreadId)
      : null;
    const chatProject = projectForChat(config, Number(chatId.replace(/\D/g, "")) || 0)
      ?? config.default_project
      ?? null;
    const effectiveContext = mergeTopicContext(boundContext, chatProject);

    if (effectiveContext) {
      consola.info(`[bot] context: ${formatContext(effectiveContext)}`);
    }

    // 获取 resume token（topic 隔离）
    const resume = getResume(chatId, ownerId, topicThreadId);

    consola.info(`[bot] message from ${message.author.userName}: ${text.slice(0, 100)}`);

    // 解析项目 CWD
    let cwd: string | undefined;
    if (effectiveContext?.project) {
      const project = resolveProject(config, effectiveContext.project);
      if (project) {
        cwd = project.path;
      }
    }

    const startTime = Date.now();

    // 立即发送初始进度消息，不等待 runner 启动
    const initHeader = formatHeader(0, null, { label: "▸", engine: "opencode" });
    const progressMsg: SentMessage = await thread.post({ markdown: `${initHeader}\n\n_Thinking..._` });

    let lastUpdateTime = Date.now();
    let finalAnswer = "";
    let finalResume: ResumeToken | undefined;
    const actionLines: string[] = [];
    let currentModel: string | undefined;
    let streamingText: string | null = null;
    let pendingUpdate = false;
    let editInFlight: Promise<unknown> | null = null;

    /** 串行化 edit 操作，避免竞争 */
    const safeEdit = async (markdown: string) => {
      if (editInFlight) {
        await editInFlight;
      }
      const p = progressMsg.edit({ markdown }).catch(() => {
        // Edit may fail if message was deleted
      });
      editInFlight = p;
      await p;
      editInFlight = null;
    };

    /** 节流更新进度消息 */
    const flushProgress = async (force = false) => {
      const now = Date.now();
      const interval = streamingText ? TEXT_UPDATE_INTERVAL : STREAM_UPDATE_INTERVAL;
      if (!force && now - lastUpdateTime < interval) {
        pendingUpdate = true;
        return;
      }
      pendingUpdate = false;
      lastUpdateTime = now;
      const elapsed = (now - startTime) / 1000;
      const markdown = buildProgressMarkdown(elapsed, actionLines, streamingText);
      await safeEdit(markdown);
    };

    try {
      for await (const event of runner.run(text, resume, { cwd })) {
        switch (event.type) {
          case "started": {
            finalResume = event.resume;
            currentModel = event.model;
            // 保存 session（topic 隔离）
            saveResume(chatId, ownerId, topicThreadId, event.resume);
            // 更新进度消息，移除 "Thinking..."
            await flushProgress(true);
            break;
          }

          case "action": {
            const icon = event.phase === "completed"
              ? (event.ok !== false ? "✓" : "✗")
              : "▸";
            const line = `${icon} ${event.action.title}`;

            if (event.phase === "started") {
              actionLines.push(line);
            } else if (event.phase === "completed") {
              // Replace the started line with completed
              const idx = actionLines.findIndex(l => l.includes(event.action.title));
              if (idx >= 0) {
                actionLines[idx] = line;
              } else {
                actionLines.push(line);
              }
            }

            await flushProgress();
            break;
          }

          case "text": {
            streamingText = event.accumulated;
            await flushProgress();
            break;
          }

          case "completed": {
            // 完成后不再需要流式更新
            pendingUpdate = false;

            finalAnswer = event.answer;
            if (event.resume) {
              finalResume = event.resume;
              saveResume(chatId, ownerId, topicThreadId, event.resume);
            }

            const elapsed2 = (Date.now() - startTime) / 1000;
            const statusIcon = event.ok ? "✓" : "✗";
            const header = formatHeader(elapsed2, null, { label: statusIcon, engine: "opencode" });

            // 构建 footer：actions + model
            const footerParts: string[] = [];
            if (actionLines.length > 0) {
              footerParts.push(actionLines.join("\n"));
            }
            if (currentModel) {
              footerParts.push(`\`model: ${currentModel}\``);
            }

            // 构建最终消息
            const parts = {
              header,
              body: finalAnswer || undefined,
              footer: footerParts.length > 0 ? footerParts.join("\n\n") : undefined,
            };

            const messages = prepareMultiMessage(parts);

            // 等待之前的流式 edit 完成，避免竞争
            if (editInFlight) {
              await editInFlight;
              editInFlight = null;
            }

            // 编辑第一条消息
            try {
              await progressMsg.edit({ markdown: messages[0]! });
            } catch {
              await thread.post({ markdown: messages[0]! });
            }
            // 发送后续消息
            for (let i = 1; i < messages.length; i++) {
              await thread.post({ markdown: messages[i]! });
            }
            break;
          }
        }
      }

      // 如果有待刷新的更新，最后刷一次
      if (pendingUpdate) {
        await flushProgress(true);
      }
    } catch (err) {
      consola.error("[bot] runner error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      try {
        await progressMsg.edit({ markdown: `✗ · opencode · error\n\n${errorMsg}` });
      } catch {
        await thread.post({ markdown: `✗ · opencode · error\n\n${errorMsg}` });
      }
    }
  }

  // 注册事件处理器
  // 处理私聊消息（群组消息通过 onNewMention 处理）
  chat.onNewMessage(/.*/, async (thread, message) => {
    // 忽略 bot 自己的消息
    if (message.author.isMe) return;
    // 只处理私聊，群组消息由 onNewMention 处理
    // thread.channelId 格式: "telegram:{chatId}" 或 "telegram:{chatId}:{threadId}"
    // 私聊 chatId 是正数，群组是负数
    const chatIdStr = thread.channelId.split(":")[1] ?? "";
    const chatId = Number(chatIdStr);
    if (chatId < 0) {
      // 群组消息，跳过（等待 onNewMention）
      return;
    }
    consola.info(`[bot] onNewMessage (private): ${message.text.slice(0, 50)}`);
    await thread.subscribe();
    await handleMessage(thread, message);
  });

  // 处理群组 @ 提及
  chat.onNewMention(async (thread, message) => {
    consola.info(`[bot] onNewMention: ${message.text.slice(0, 50)}`);
    await thread.subscribe();
    await handleMessage(thread, message);
  });

  // 处理已订阅 thread 的后续消息
  chat.onSubscribedMessage(async (thread, message) => {
    // 忽略 bot 自己的消息
    if (message.author.isMe) return;
    consola.info(`[bot] onSubscribedMessage: ${message.text.slice(0, 50)}`);
    await handleMessage(thread, message);
  });

  // 取消按钮处理
  chat.onAction("cancel", async (event) => {
    await event.thread.post("⚠️ Cancel requested (not yet implemented)");
  });

  return { chat, runner, sessionStore, stateAdapter, topicStore };
}