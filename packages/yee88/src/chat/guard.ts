// src/chat/guard.ts - 权限验证
import type { Message } from "chat";
import type { AppConfig } from "../config/index.ts";

/**
 * 检查用户是否有权限使用 bot。
 * - allowed_users 为空 → 允许所有人
 * - allowed_users 非空 → 仅允许列表中的用户
 */
export function isAuthorized(message: Message, config: AppConfig): boolean {
  const allowedUsers = config.telegram?.allowed_users ?? [];
  if (allowedUsers.length === 0) return true;

  const userId = message.author.userId;
  // Telegram userId 是数字，但 chat SDK 可能传字符串
  const numericId = Number(userId);
  if (Number.isNaN(numericId)) return false;

  return allowedUsers.includes(numericId);
}

/** 生成未授权提示消息 */
export function unauthorizedMessage(): string {
  return "⚠️ 您没有使用此 bot 的权限。请联系管理员将您的 user ID 添加到 `allowed_users` 配置中。";
}