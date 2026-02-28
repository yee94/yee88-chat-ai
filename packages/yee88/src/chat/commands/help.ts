// src/chat/commands/help.ts - /help 命令：显示帮助信息

import type { CommandContext, CommandResult } from "./index.ts";

const HELP_TEXT = `\
*yee88* — AI coding assistant

commands:
/new — start a new conversation
/model — view/set model
/model set <model> — switch model
/model clear — reset to default model
/help — show this help

send any message to chat with the AI\\.
use /new to clear session and start fresh\\.`;

/**
 * /help, /start - 显示帮助信息。
 */
export async function handleHelp(_ctx: CommandContext): Promise<CommandResult> {
  return { text: HELP_TEXT };
}