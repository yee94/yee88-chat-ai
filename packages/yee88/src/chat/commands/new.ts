// src/chat/commands/new.ts - /new 命令：开始新会话
import type { CommandContext, CommandResult } from "./index.ts";

/**
 * /new - 清除当前 session，开始新会话。
 *
 * 用法：
 *   /new          - 清除 session 并开始新对话
 *   /new <prompt> - 清除 session 并以 prompt 开始新对话
 */
export async function handleNew(ctx: CommandContext): Promise<CommandResult> {
  const { services, chatId, ownerId, topicThreadId } = ctx;
  const { sessionStore, topicStore } = services;

  // 清除 topic 级别 session
  if (topicThreadId) {
    topicStore.clearSessions(chatId, topicThreadId);
  }

  // 清除 chat 级别 session
  sessionStore.clearSessions(chatId, ownerId);

  return {
    text: "✓ session cleared, new conversation started\\.",
  };
}