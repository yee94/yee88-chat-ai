// src/chat/commands/index.ts - 命令路由器
import type { Thread, SentMessage } from "chat";
import type { CoreServices, BotThreadState, Platform } from "../bot-core.ts";

/** 命令上下文 */
export interface CommandContext {
  services: CoreServices;
  thread: Thread<BotThreadState>;
  platform: Platform;
  chatId: string;
  ownerId: string;
  topicThreadId: string | null;
  /** 命令参数文本（不含命令名） */
  args: string;
}

/** 命令处理结果 */
export interface CommandResult {
  /** 回复文本（Markdown） */
  text: string;
}

/** 命令处理函数 */
export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;

/** 已注册的命令 */
const commands = new Map<string, CommandHandler>();

/** 注册命令 */
export function registerCommand(name: string, handler: CommandHandler): void {
  commands.set(name.toLowerCase(), handler);
}

/**
 * 解析斜杠命令。
 * 返回 [命令名, 参数文本] 或 null（不是命令）。
 */
export function parseCommand(text: string): [string, string] | null {
  const stripped = text.trimStart();
  if (!stripped.startsWith("/")) return null;

  const lines = stripped.split("\n");
  const firstLine = lines[0]!;
  const spaceIdx = firstLine.indexOf(" ");
  const token = spaceIdx === -1 ? firstLine : firstLine.slice(0, spaceIdx);

  let command = token.slice(1); // 去掉 "/"
  if (!command) return null;

  // 去掉 @botname 后缀
  if (command.includes("@")) {
    command = command.split("@", 2)[0]!;
  }

  // 参数：第一行剩余 + 后续行
  let argsText = spaceIdx === -1 ? "" : firstLine.slice(spaceIdx + 1);
  if (lines.length > 1) {
    const tail = lines.slice(1).join("\n");
    argsText = argsText ? `${argsText}\n${tail}` : tail;
  }

  return [command.toLowerCase(), argsText];
}

/**
 * 尝试处理命令。
 * 返回 true 表示已处理（是命令），false 表示不是命令。
 */
export async function tryHandleCommand(
  text: string,
  ctx: Omit<CommandContext, "args">,
): Promise<boolean> {
  const parsed = parseCommand(text);
  if (!parsed) return false;

  const [command, args] = parsed;
  const handler = commands.get(command);
  if (!handler) {
    // 未知命令，不拦截，让它传给 runner
    return false;
  }

  const result = await handler({ ...ctx, args });
  await ctx.thread.post({ markdown: result.text });
  return true;
}

// 注册所有命令
import { handleNew } from "./new.ts";
import { handleModel } from "./model.ts";
import { handleHelp } from "./help.ts";

registerCommand("new", handleNew);
registerCommand("model", handleModel);
registerCommand("help", handleHelp);
registerCommand("start", handleHelp); // /start 也显示帮助