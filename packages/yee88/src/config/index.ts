// src/config/index.ts - 配置管理
import { z } from "zod/v4";
import { consola } from "consola";
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";

const TOML = require("@iarna/toml");

export const HOME_CONFIG_PATH = join(homedir(), ".yee88", "config.toml");

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// --- Zod Schemas ---

export const ProjectConfigSchema = z.object({
  alias: z.string().optional(),
  path: z.string(),
  worktrees_dir: z.string().default(".worktrees"),
  default_engine: z.string().optional(),
  worktree_base: z.string().optional(),
  chat_id: z.number().optional(),
  system_prompt: z.string().optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const PlatformSchema = z.enum(["telegram", "dingtalk"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const AppConfigSchema = z.object({
  default_platform: PlatformSchema.optional(),
  telegram: z
    .object({
      bot_token: z.string().optional(),
      allowed_users: z.array(z.number()),
    })
    .default({ allowed_users: [] }),
  dingtalk: z
    .object({
      client_id: z.string().optional(),
      client_secret: z.string().optional(),
      robot_code: z.string().optional(),
      corp_id: z.string().optional(),
      agent_id: z.string().optional(),
      /** 消息交互方式: "ai_card" (流式卡片), "recall" (撤回重发), "webhook" (session webhook) */
      reply_mode: z.enum(["ai_card", "recall", "webhook"]).default("ai_card"),
      /** AI Card 自定义模板 ID（留空使用钉钉标准模板） */
      card_template_id: z.string().optional(),
      allowed_users: z.array(z.string()).default([]),
    })
    .default({ reply_mode: "ai_card" as const, allowed_users: [] }),
  default_engine: z.string().default("opencode"),
  default_project: z.string().optional(),
  system_prompt: z.string().optional(),
  projects: z.record(z.string(), ProjectConfigSchema).default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// --- Config I/O ---

export function readConfig(cfgPath: string): Record<string, unknown> {
  if (!existsSync(cfgPath)) {
    throw new ConfigError(`Missing config file ${cfgPath}.`);
  }
  try {
    const raw = readFileSync(cfgPath, "utf-8");
    return TOML.parse(raw) as Record<string, unknown>;
  } catch (e) {
    throw new ConfigError(`Malformed TOML in ${cfgPath}: ${e}`);
  }
}

export function loadOrInitConfig(path?: string): { raw: Record<string, unknown>; path: string } {
  const cfgPath = path ?? HOME_CONFIG_PATH;
  if (!existsSync(cfgPath)) {
    return { raw: {}, path: cfgPath };
  }
  return { raw: readConfig(cfgPath), path: cfgPath };
}

export function loadAppConfig(path?: string): { config: AppConfig; path: string } {
  const { raw, path: cfgPath } = loadOrInitConfig(path);
  // Normalize projects keys to strings (TOML may produce symbol keys)
  const normalized: Record<string, unknown> = { ...raw };
  if (normalized.projects && typeof normalized.projects === "object") {
    const projectsObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(normalized.projects)) {
      projectsObj[String(key)] = value;
    }
    normalized.projects = projectsObj;
  }
  const config = AppConfigSchema.parse(normalized);
  return { config, path: cfgPath };
}

export function writeConfig(config: Record<string, unknown>, cfgPath: string): void {
  const dir = dirname(cfgPath);
  mkdirSync(dir, { recursive: true });
  const content = TOML.stringify(config);
  const tmpPath = `${cfgPath}.tmp`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, cfgPath);
}

// --- Project helpers ---

export function resolveProject(
  config: AppConfig,
  alias?: string
): ProjectConfig | undefined {
  const key = alias ?? config.default_project;
  if (!key) return undefined;
  return config.projects[key.toLowerCase()];
}

export function resolveSystemPrompt(
  config: AppConfig,
  alias?: string
): string | undefined {
  const project = resolveProject(config, alias);
  if (project?.system_prompt) return project.system_prompt;
  return config.system_prompt;
}

export function projectForChat(
  config: AppConfig,
  chatId: number
): string | undefined {
  for (const [alias, project] of Object.entries(config.projects)) {
    if (project.chat_id === chatId) return alias;
  }
  return undefined;
}