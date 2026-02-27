// src/chat/startup.ts - 启动消息生成
import type { AppConfig } from "../config/index.ts";
import { resolveProject } from "../config/index.ts";

/** 检查引擎是否可用（检查 CLI 是否在 PATH 中） */
async function isEngineAvailable(engine: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", engine], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/** 生成启动消息 */
export async function generateStartupMessage(config: AppConfig): Promise<string> {
  const lines: string[] = [];
  lines.push("🤖 **yee88 bot started**");
  lines.push("");

  // 默认引擎
  const engine = config.default_engine ?? "opencode";
  const available = await isEngineAvailable(engine);
  const status = available ? "✅" : "❌ not found";
  lines.push(`**Engine:** \`${engine}\` ${status}`);

  // 项目列表
  const projects = Object.entries(config.projects);
  if (projects.length > 0) {
    lines.push("");
    lines.push("**Projects:**");
    for (const [alias, project] of projects) {
      const isDefault = alias === config.default_project ? " _(default)_" : "";
      lines.push(`  • \`${alias}\`${isDefault} → \`${project.path}\``);
    }
  } else {
    lines.push("");
    lines.push("_No projects registered. Use `yee88 init <path>` to add one._");
  }

  // 权限
  const allowedUsers = config.telegram?.allowed_users ?? [];
  if (allowedUsers.length > 0) {
    lines.push("");
    lines.push(`**Allowed users:** ${allowedUsers.length} configured`);
  } else {
    lines.push("");
    lines.push("**Allowed users:** _all (no restriction)_");
  }

  // CWD
  lines.push("");
  lines.push(`**CWD:** \`${process.cwd()}\``);

  return lines.join("\n");
}