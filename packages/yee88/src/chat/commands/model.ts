// src/chat/commands/model.ts - /model 命令：查看/设置模型
import { consola } from "consola";
import { loadOrInitConfig, writeConfig } from "../../config/index.ts";
import type { CommandContext, CommandResult } from "./index.ts";

const MODEL_USAGE =
  "usage: `/model`, `/model set <model>`, or `/model clear`";

/**
 * 从 opencode CLI 获取可用模型列表。
 */
async function getOpenCodeModels(): Promise<string[]> {
  try {
    const proc = Bun.spawn(["opencode", "models"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return [];
    return stdout
      .trim()
      .split("\n")
      .map((m) => m.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * /model - 查看/设置模型。
 *
 * 用法：
 *   /model              - 显示可用模型列表
 *   /model status        - 显示当前模型状态
 *   /model set <model>   - 设置模型覆盖
 *   /model clear          - 清除模型覆盖
 */
export async function handleModel(ctx: CommandContext): Promise<CommandResult> {
  const tokens = ctx.args
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const action = tokens[0]?.toLowerCase() ?? "";

  // /model 或 /model 无参数 → 列出可用模型
  if (action === "") {
    const models = await getOpenCodeModels();
    if (models.length === 0) {
      return { text: "no models available\\." };
    }
    const lines = [
      "**Available Models**",
      "",
      "Click a command below to switch model:",
      "",
      ...models.map((m) => `/model set ${m}`),
      "",
      "**Other commands:**",
      "• `/model status` - Show current model",
      "• `/model clear` - Reset to default model",
    ];
    return { text: lines.join("\n\n") };
  }

  // /model status → 显示当前状态
  if (action === "status") {
    const { runner } = ctx.services;
    const currentModel = runner.model ?? "default";
    return {
      text: [
        "**Current Model Status**",
        "",
        "• Engine: `opencode`",
        `• Model: \`${currentModel}\``,
      ].join("\n\n"),
    };
  }
  // /model set <model> → 设置模型覆盖
  if (action === "set") {
    const model = tokens[1];
    if (!model) {
      return { text: MODEL_USAGE };
    }
    // 保存到 config.toml 持久化
    const { raw, path: cfgPath } = loadOrInitConfig();
    raw["default_model"] = model;
    writeConfig(raw, cfgPath);
    // 同时更新内存中的 runner
    ctx.services.runner.setModelOverride(model);
    if (ctx.topicThreadId) {
      ctx.services.topicStore.setModelOverride(ctx.chatId, ctx.topicThreadId, model);
    }
    consola.info(`[model] model set to: ${model} (saved to config.toml)`);
    return { text: `✓ model set to \`${model}\`` };
  }

  // /model clear → 清除模型覆盖
  if (action === "clear" || action === "reset") {
    // 从 config.toml 删除 default_model
    const { raw, path: cfgPath } = loadOrInitConfig();
    delete raw["default_model"];
    writeConfig(raw, cfgPath);
    // 同时清除内存中的覆盖
    ctx.services.runner.setModelOverride(undefined);
    if (ctx.topicThreadId) {
      ctx.services.topicStore.setModelOverride(ctx.chatId, ctx.topicThreadId, null);
    }
    consola.info("[model] model override cleared (saved to config.toml)");
    return { text: "✓ model override cleared" };
  }

  return { text: MODEL_USAGE };
}