// src/chat/bot-dingtalk.ts - DingTalk Bot 定义
import { Chat, type Thread, type Message } from "chat";
import { createDingTalkAdapter, type DingTalkAdapter } from "@chat-adapter/dingtalk";
import { consola } from "consola";
import { MemoryStateAdapter } from "./state.ts";
import {
  type BotThreadState,
  type CoreServices,
  createCoreServices,
  handleMessage,
} from "./bot-core.ts";
import { isAuthorizedDingTalk, unauthorizedMessage } from "./guard.ts";
import type { AppConfig } from "../config/index.ts";

/** 创建 DingTalk Bot 实例 */
export function createDingTalkBot(config: AppConfig) {
  const dingtalkConfig = config.dingtalk;
  if (!dingtalkConfig?.client_id || !dingtalkConfig?.client_secret) {
    throw new Error("Missing dingtalk.client_id or dingtalk.client_secret in config");
  }

  const stateAdapter = new MemoryStateAdapter();
  const services = createCoreServices(config);

  const dingtalkAdapter = createDingTalkAdapter({
    clientId: dingtalkConfig.client_id,
    clientSecret: dingtalkConfig.client_secret,
    robotCode: dingtalkConfig.robot_code,
    corpId: dingtalkConfig.corp_id,
    agentId: dingtalkConfig.agent_id,
    // reply_mode 控制消息交互方式:
    // "ai_card" → cardTemplateId 使用标准模板或自定义模板
    // "recall"  → cardTemplateId = "" 禁用 AI Card
    // "webhook" → cardTemplateId = "" 禁用 AI Card
    cardTemplateId: dingtalkConfig.reply_mode === "ai_card"
      ? (dingtalkConfig.card_template_id || undefined)
      : "",
  }) as DingTalkAdapter;

  const chat = new Chat<{ dingtalk: ReturnType<typeof createDingTalkAdapter> }, BotThreadState>({
    userName: "yee88",
    adapters: { dingtalk: dingtalkAdapter },
    state: stateAdapter,
    logger: "info",
  });

  // 消息处理包装器（添加权限验证 + AI Card finalize）
  async function handleMessageWithAuth(thread: Thread<BotThreadState>, message: Message): Promise<void> {
    // 权限验证
    if (!isAuthorizedDingTalk(message, config)) {
      consola.warn(`[bot-dingtalk] unauthorized user: ${message.author.userId} (${message.author.userName})`);
      await thread.post(unauthorizedMessage());
      return;
    }

    await handleMessage(services, thread, message, "dingtalk", {
      onStreamFinalize: async (sentMessage, finalContent) => {
        // 通知 DingTalk adapter 完成 AI Card 流式输出
        await dingtalkAdapter.finalizeMessage(
          sentMessage.threadId,
          sentMessage.id,
          { markdown: finalContent },
        );
      },
    });
  }

  // 处理私聊消息
  chat.onNewMessage(/.*/, async (thread, message) => {
    if (message.author.isMe) return;
    
    // DingTalk conversationType: "1" = DM, "2" = group
    // thread.channelId 格式: "dingtalk:{conversationId}"
    const parts = thread.id.split(":");
    // 检查是否为私聊（需要从 raw message 判断，这里简化处理）
    consola.info(`[bot-dingtalk] onNewMessage: ${message.text.slice(0, 50)}`);
    await thread.subscribe();
    await handleMessageWithAuth(thread, message);
  });

  // 处理群组 @ 提及
  chat.onNewMention(async (thread, message) => {
    consola.info(`[bot-dingtalk] onNewMention: ${message.text.slice(0, 50)}`);
    await thread.subscribe();
    await handleMessageWithAuth(thread, message);
  });

  // 处理已订阅 thread 的后续消息
  chat.onSubscribedMessage(async (thread, message) => {
    if (message.author.isMe) return;
    consola.info(`[bot-dingtalk] onSubscribedMessage: ${message.text.slice(0, 50)}`);
    await handleMessageWithAuth(thread, message);
  });

  // 取消按钮处理
  chat.onAction("cancel", async (event) => {
    await event.thread.post("⚠️ Cancel requested (not yet implemented)");
  });

  return { chat, stateAdapter, ...services };
}