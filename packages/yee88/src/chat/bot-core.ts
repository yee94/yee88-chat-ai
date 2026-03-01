// src/chat/bot-core.ts - 核心消息处理逻辑（adapter 无关）
import type { Thread, Message, SentMessage, Author } from "chat";
import { consola } from "consola";
import { OpenCodeRunner } from "../runner/opencode.ts";
import { SessionStore } from "../session/store.ts";
import { TopicStateStore, type RunContext } from "../topic/state.ts";
import { formatFooter, prepareMultiMessage, formatActionLine, formatActionTitle } from "../markdown/index.ts";
import { mergeTopicContext, formatContext } from "../topic/context.ts";
import type { Yee88Event, ResumeToken } from "../model.ts";
import { type AppConfig, projectForChat, resolveProject, resolveSystemPrompt } from "../config/index.ts";
import { tryHandleCommand } from "./commands/index.ts";
import { isDebugEnabled, debugLog, debugError, debugJson, debugEvent } from "../debug.ts";

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
  const runner = new OpenCodeRunner({ model: config.default_model });
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

/** 构建带会话上下文的 system_prompt，注入对话者身份信息 */
function buildSystemPromptWithChatContext(
  basePrompt: string | undefined,
  author: Author,
  platform: Platform,
): string | undefined {
  const name = author.fullName || author.userName;
  if (!name) return basePrompt;

  const chatContext = `[Chat Context] 你正在通过 ${platform === "telegram" ? "Telegram" : "DingTalk"} 与「${name}」对话。可以在回复中自然地使用对方的称呼。`;

  if (!basePrompt) return chatContext;
  return `${basePrompt}\n\n${chatContext}`;
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
  const parts: string[] = [];

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

  // footer：状态 + 耗时
  parts.push(formatFooter(elapsed, { label }));

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
  const isIncremental = options?.replyMode === "incremental";

  // 立即发送初始进度消息，不等待 runner 启动（incremental 模式下跳过）
  let progressMsg: SentMessage | null = null;
  if (!isIncremental) {
    progressMsg = await thread.post({ markdown: `_Thinking..._` });
  }

  let lastUpdateTime = Date.now();
  let finalAnswer = "";
  let finalResume: ResumeToken | undefined;
  const actionLines: string[] = [];
  let currentModel: string | undefined;
  let streamingText: string | null = null;
  let pendingUpdate = false;
  let editInFlight: Promise<unknown> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  // incremental 模式：收集连续的 action，遇到非 action 事件时 flush
  const pendingActionLines: string[] = [];

  /** incremental 模式：flush 缓冲区中的 action 行为一条消息（emoji 标题 + list） */
  const flushActionBatch = async () => {
    if (pendingActionLines.length === 0) return;
    const batch = pendingActionLines.splice(0);
    const list = batch.map((l) => `• ${l}`).join("\n");
    await thread.post({ markdown: `🔧 工具调用\n${list}` });
  };

  /** 串行化 edit 操作，避免竞争（incremental 模式下不使用） */
  const safeEdit = async (markdown: string) => {
    if (isIncremental || !progressMsg) return;
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

  /** 节流更新进度消息，带定时器保底刷新（incremental 模式下不使用） */
  const flushProgress = async (force = false) => {
    if (isIncremental) return;
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

  // 确定本次请求使用的模型（topic override > runner override > config default）
  let effectiveModel: string | undefined;
  if (topicThreadId) {
    const topicModel = services.topicStore.getModelOverride(chatId, topicThreadId);
    if (topicModel) {
      effectiveModel = topicModel;
      debugLog("bot-core", `using model from topic override: ${topicModel}`);
    }
  }
  if (!effectiveModel) {
    effectiveModel = runner.getEffectiveModel();
    if (effectiveModel) {
      debugLog("bot-core", `using model from runner/config: ${effectiveModel}`);
    }
  }

  try {
    // 解析 system_prompt（项目级 > 全局级），仅首次会话时生效
    const baseSystemPrompt = resolveSystemPrompt(config, effectiveContext?.project ?? undefined);
    // 注入会话上下文：告诉 agent 当前对话者的身份信息
    const systemPrompt = buildSystemPromptWithChatContext(baseSystemPrompt, message.author, platform);
    for await (const event of runner.run(text, resume, { cwd, model: effectiveModel, system: systemPrompt })) {
      debugEvent("bot-core", event);

      switch (event.type) {
        case "started": {
          finalResume = event.resume;
          currentModel = event.model;
          debugLog("bot-core", `started: model=${event.model}, resume=${event.resume.value}`);
          // 保存 session（topic 隔离）
          saveResume(services, chatId, ownerId, topicThreadId, event.resume);
          // 更新进度消息，移除 "Thinking..."
          await flushProgress(true);
          break;
        }

        case "action": {
          debugLog("bot-core", `action: phase=${event.phase}, kind=${event.action.kind}, title=${event.action.title}, isIncremental=${isIncremental}`);
          if (isDebugEnabled()) {
            debugJson("bot-core", "action detail", event.action.detail);
          }

          // show_actions 关闭时跳过 action 行的收集和发送
          if (!config.show_actions) break;

          // incremental 模式：简洁格式，只在 completed 时发送，节流合并
          const line = formatActionLine(event.action, event.phase, event.ok, { detailed: false });

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

            // incremental 模式：completed 时收集到缓冲区（纯标题，不带状态图标）
            if (isIncremental) {
              const title = formatActionTitle(event.action);
              if (title) {
                debugLog("bot-core", `enqueue action completed, ok=${event.ok}`);
                pendingActionLines.push(title);
              }
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

        case "text_finished": {
          // 遇到非 action 事件，先 flush action 缓冲区
          if (isIncremental) await flushActionBatch();
          // agent 一轮文本输出完毕（转去调用工具），将中间文本作为独立消息发送
          debugLog("bot-core", `text_finished: len=${event.text.length}, isIncremental=${isIncremental}`);
          if (isIncremental && event.text) {
            await thread.post({ markdown: event.text });
          }
          // 重置流式文本预览（下一轮 step 会重新累积）
          streamingText = null;
          break;
        }

        case "completed": {
          debugLog("bot-core", `completed: ok=${event.ok}, answer_len=${event.answer?.length ?? 0}`);
          // 完成后不再需要流式更新
          pendingUpdate = false;
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

          // incremental 模式：flush 残留的 action 缓冲区
          if (isIncremental) {
            await flushActionBatch();
          }

          finalAnswer = event.answer;
          if (event.resume) {
            finalResume = event.resume;
            saveResume(services, chatId, ownerId, topicThreadId, event.resume);
          }

          const elapsed2 = (Date.now() - startTime) / 1000;
          const statusIcon = event.ok ? "✓" : "✗";

          // 构建最终消息（无 header，footer 包含状态 + 耗时 + model）
          const parts = {
            body: finalAnswer || undefined,
            footer: formatFooter(elapsed2, { label: statusIcon, model: currentModel }),
          };

          const messages = prepareMultiMessage(parts);

          if (isIncremental) {
            // incremental 模式：直接发送所有消息
            for (const msg of messages) {
              await thread.post({ markdown: msg });
            }
          } else {
            // 等待之前的流式 edit 完成，避免竞争
            if (editInFlight) {
              await editInFlight;
              editInFlight = null;
            }

            // 编辑第一条消息
            try {
              await progressMsg!.edit({ markdown: messages[0]! });
            } catch {
              await thread.post({ markdown: messages[0]! });
            }
            // 通知 adapter 流式输出完成（如 DingTalk AI Card finalize）
            if (options?.onStreamFinalize && progressMsg) {
              await options.onStreamFinalize(progressMsg, messages[0]!).catch(() => {});
            }
            // 发送后续消息
            for (let i = 1; i < messages.length; i++) {
              await thread.post({ markdown: messages[i]! });
            }
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
    debugError("bot-core", "runner error:", err);
    consola.error("[bot] runner error:", err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    if (errorStack) {
      debugError("bot-core", "error stack:", errorStack);
    }
    const errorMarkdown = `${errorMsg}\n\n✗ · error`;
    if (isIncremental) {
      // incremental 模式：直接发送错误消息
      await thread.post({ markdown: errorMarkdown });
    } else {
      try {
        await progressMsg!.edit({ markdown: errorMarkdown });
      } catch {
        await thread.post({ markdown: errorMarkdown });
      }
      // 通知 adapter 流式输出完成（错误情况）
      if (options?.onStreamFinalize && progressMsg) {
        await options.onStreamFinalize(progressMsg, errorMarkdown).catch(() => {});
      }
    }
  }
}

          