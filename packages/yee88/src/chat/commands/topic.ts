// src/chat/commands/topic.ts - /topic 命令：Topic 管理
import type { CommandContext, CommandResult } from "./index.ts";

/**
 * /topic list - 列出当前 chat 的所有 topic
 */
export async function handleTopic(ctx: CommandContext): Promise<CommandResult> {
  const { services, chatId, args } = ctx;
  const { topicStore } = services;

  const subCmd = args.trim().split(/\s+/)[0]?.toLowerCase() || "list";

  if (subCmd === "list") {
    const threads = topicStore.listThreads(chatId);

    if (threads.length === 0) {
      return {
        text: "No topics found for this chat.",
      };
    }

    const lines = ["**Topics:**"];
    for (const thread of threads) {
      const parts: string[] = [];
      parts.push(`• \`${thread.threadId}\``);

      if (thread.topicTitle) {
        parts.push(`"${thread.topicTitle}"`);
      }

      if (thread.context?.project) {
        parts.push(`[${thread.context.project}]`);
        if (thread.context.branch) {
          parts.push(`(${thread.context.branch})`);
        }
      }

      const sessionCount = Object.keys(thread.sessions).length;
      if (sessionCount > 0) {
        parts.push(`{${sessionCount} session(s)}`);
      }

      lines.push(parts.join(" "));
    }

    return {
      text: lines.join("\n"),
    };
  }

  return {
    text: `Unknown /topic subcommand: ${subCmd}\n\nUsage:\n• /topic list - List all topics`,
  };
}