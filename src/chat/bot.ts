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
    let resume = getResume(chatId, ownerId, topicThreadId);

    consola.info(`[bot] message from ${message.author.userName}: ${text.slice(0, 100)}`);

    // 显示 typing 状态
    await thread.startTyping("Thinking...");

    // 解析项目 CWD
    let cwd: string | undefined;
    if (effectiveContext?.project) {
      const project = resolveProject(config, effectiveContext.project);
      if (project) {
        cwd = project.path;
      }
    }

    // 运行 OpenCode
    let progressMsg: SentMessage | null = null;
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 2000; // 2 秒更新一次进度
    const startTime = Date.now();
    let finalAnswer = "";
    let finalResume: ResumeToken | undefined;
    let actionLines: string[] = [];

    try {
      for await (const event of runner.run(text, resume, { cwd })) {
        const elapsed = (Date.now() - startTime) / 1000;

        switch (event.type) {
          case "started": {
            finalResume = event.resume;
            // 保存 session（topic 隔离）
            saveResume(chatId, ownerId, topicThreadId, event.resume);

            const header = formatHeader(elapsed, null, { label: "▸", engine: "opencode" });
            progressMsg = await thread.post({ markdown: header });
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

            // Throttle progress updates
            const now = Date.now();
            if (progressMsg && now - lastUpdateTime > UPDATE_INTERVAL) {
              lastUpdateTime = now;
              const header = formatHeader(elapsed, null, { label: "▸", engine: "opencode" });
              const body = actionLines.join("\n");
              try {
                await progressMsg.edit({ markdown: `${header}\n\n${body}` });
              } catch {
                // Edit may fail if message was deleted
              }
            }
            break;
          }

          case "completed": {
            finalAnswer = event.answer;
            if (event.resume) {
              finalResume = event.resume;
              saveResume(chatId, ownerId, topicThreadId, event.resume);
            }

            const elapsed2 = (Date.now() - startTime) / 1000;
            const statusIcon = event.ok ? "✓" : "✗";
            const header = formatHeader(elapsed2, null, { label: statusIcon, engine: "opencode" });

            // 构建最终消息
            const parts = {
              header,
              body: finalAnswer || undefined,
              footer: actionLines.length > 0 ? actionLines.join("\n") : undefined,
            };

            const messages = prepareMultiMessage(parts);

            if (progressMsg) {
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
            } else {
              for (const msg of messages) {
                await thread.post({ markdown: msg });
              }
            }
            break;
          }
        }
      }
    } catch (err) {
      consola.error("[bot] runner error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (progressMsg) {
        try {
          await progressMsg.edit({ markdown: `✗ · opencode · error\n\n${errorMsg}` });
        } catch {
          await thread.post({ markdown: `✗ · opencode · error\n\n${errorMsg}` });
        }
      } else {
        await thread.post({ markdown: `✗ · opencode · error\n\n${errorMsg}` });
      }
    }
  }

  // 注册事件处理器
  chat.onNewMention(async (thread, message) => {
    await thread.subscribe();
    await handleMessage(thread, message);
  });

  chat.onSubscribedMessage(async (thread, message) => {
    // 忽略 bot 自己的消息
    if (message.author.isMe) return;
    await handleMessage(thread, message);
  });

  // 取消按钮处理
  chat.onAction("cancel", async (event) => {
    await event.thread.post("⚠️ Cancel requested (not yet implemented)");
  });

  return { chat, runner, sessionStore, stateAdapter, topicStore };
}