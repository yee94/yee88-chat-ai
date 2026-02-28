// src/chat/bot-core.ts - 核心消息处理逻辑（adapter 无关）
import type { Thread, Message, SentMessage } from "chat";
import { consola } from "consola";
import { OpenCodeRunner } from "../runner/opencode.ts";
import { SessionStore } from "../session/store.ts";
import { TopicStateStore, type RunContext } from "../topic/state.ts";
import { formatElapsed, formatHeader, assembleMarkdownParts, prepareMultiMessage } from "../markdown/index.ts";
import { mergeTopicContext, formatContext } from "../topic/context.ts";
import type { Yee88Event, ResumeToken } from "../model.ts";
import { type AppConfig, projectForChat, resolveProject } from "../config/index.ts";
import { tryHandleCommand } from "./commands/index.ts";

/** Bot 线程状态 */
export interface BotThreadState {
  projectAlias?: string;
  engineOverride?: string;
}

/** 平台类型 */
export type Platform = "telegram" | "dingtalk";

/** 核心服务依赖 */
export interface CoreServices {
  runner: OpenCodeRunner;
  sessionStore: SessionStore;
  topicStore: TopicStateStore;
  config: AppConfig;
}

/** 创建核心服务 */
export function createCoreServices(config: AppConfig): CoreServices {
  const runner = new OpenCodeRunner({ model: undefined });
  const sessionStore = new SessionStore(
    `${process.env["HOME"]}/.yee88/sessions.json`
  );
  const topicStore = new TopicStateStore(
    `${process.env["HOME"]}/.yee88/topics.json`
  );

  return { runner, sessionStore, topicStore, config };
}

/** 从 thread.id 解析出 topic 的 messageThreadId（如果有） */
export function parseTopicId(thread: Thread<BotThreadState>, platform: Platform): string | null {
  // telegram: "telegram:{chatId}" 或 "telegram:{chatId}:{messageThreadId}"
  // dingtalk: "dingtalk:{conversationId}" 或 "dingtalk:{conversationId}:{topicId}"
  const parts = thread.id.split(":");
  return parts.length >= 3 ? parts[2]! : null;
}

/** 获取 session resume token，topic 优先，fallback 到 chat 级别 */
export function getResume(
  services: CoreServices,
  chatId: string,
  ownerId: string,
  topicThreadId: string | null
): ResumeToken | null {
  const { sessionStore, topicStore } = services;
  
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
export function saveResume(
  services: CoreServices,
  chatId: string,
  ownerId: string,
  topicThreadId: string | null,
  token: ResumeToken
): void {
  const { sessionStore, topicStore } = services;
  
  if (topicThreadId) {
    topicStore.setSessionResume(chatId, topicThreadId, token.engine, token.value);
  }
  sessionStore.setSessionResume(chatId, ownerId, token);
}

/** 流式进度消息的最大文本预览长度 */
const MAX_STREAMING_TEXT = 2000;
/** 流式更新间隔（毫秒） */
const STREAM_UPDATE_INTERVAL = 1200;
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
    // 截断过长的流式文本
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

/** 消息处理选项 */
export interface HandleMessageOptions {
  /** 流式消息完成后的回调，用于通知 adapter 完成流式输出（如 DingTalk AI Card finalize） */
  onStreamFinalize?: (sentMessage: SentMessage, finalContent: string) => Promise<void>;
  /** DingTalk reply_mode，用于判断是否使用逐条消息发送 */
  replyMode?: "ai_card" | "recall" | "webhook" | "incremental";
}

/** 核心消息处理逻辑 */
export async function handleMessage(
  services: CoreServices,
  thread: Thread<BotThreadState>,
  message: Message,
  platform: Platform,
  options?: HandleMessageOptions,
): Promise<void> {
  const { runner, config } = services;
  const text = message.text.trim();
  if (!text) return;

  const chatId = thread.channelId;
  const ownerId = message.author.userId;
  const topicThreadId = parseTopicId(thread, platform);

  // 尝试处理斜杠命令（/new, /model, /help 等）
  const handled = await tryHandleCommand(text, {
    services,
    thread,
    platform,
    chatId,
    ownerId,
    topicThreadId,
  });
  if (handled) return;

  // 解析 topic context → 合并 chat 默认项目
  const boundContext = topicThreadId
    ? services.topicStore.getContext(chatId, topicThreadId)
    : null;
  const chatProject = projectForChat(config, Number(chatId.replace(/\D/g, "")) || 0)
    ?? config.default_project
    ?? null;
  const effectiveContext = mergeTopicContext(boundContext, chatProject);

  if (effectiveContext) {
    consola.info(`[bot] context: ${formatContext(effectiveContext)}`);
  }

  // 获取 resume token（topic 隔离）
  const resume = getResume(services, chatId, ownerId, topicThreadId);

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
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** 节流更新进度消息，带定时器保底刷新 */
  const flushProgress = async (force = false) => {
    const now = Date.now();
    const interval = streamingText ? TEXT_UPDATE_INTERVAL : STREAM_UPDATE_INTERVAL;
    if (!force && now - lastUpdateTime < interval) {
      pendingUpdate = true;
      // 设置定时器保底刷新，确保 pending 更新不会被吞掉
      if (!flushTimer) {
        const remaining = interval - (now - lastUpdateTime);
        flushTimer = setTimeout(() => {
          flushTimer = null;
          if (pendingUpdate) {
            flushProgress(true);
          }
        }, remaining);
      }
      return;
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
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
          saveResume(services, chatId, ownerId, topicThreadId, event.resume);
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

            // 逐条消息模式：每个 action 完成后发送独立消息
            if (options?.replyMode === "incremental") {
              await thread.post({ markdown: line });
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
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

          finalAnswer = event.answer;
          if (event.resume) {
            finalResume = event.resume;
            saveResume(services, chatId, ownerId, topicThreadId, event.resume);
          }

          const elapsed2 = (Date.now() - startTime) / 1000;
          const statusIcon = event.ok ? "✓" : "✗";
          const header = formatHeader(elapsed2, null, { label: statusIcon, engine: "opencode" });

          // 构建 footer：仅 model 信息（actions 是中间过程，不带入最终消息）
          const footerParts: string[] = [];
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
          // 通知 adapter 流式输出完成（如 DingTalk AI Card finalize）
          if (options?.onStreamFinalize) {
            await options.onStreamFinalize(progressMsg, messages[0]!).catch(() => {});
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
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    consola.error("[bot] runner error:", err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorMarkdown = `✗ · opencode · error\n\n${errorMsg}`;
    try {
      await progressMsg.edit({ markdown: errorMarkdown });
    } catch {
      await thread.post({ markdown: errorMarkdown });
    }
    // 通知 adapter 流式输出完成（错误情况）
    if (options?.onStreamFinalize) {
      await options.onStreamFinalize(progressMsg, errorMarkdown).catch(() => {});
    }
  }
}