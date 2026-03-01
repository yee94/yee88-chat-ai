// src/__tests__/config.test.ts
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  loadAppConfig,
  writeConfig,
  resolveProject,
  resolveSystemPrompt,
  projectForChat,
  type AppConfig,
  AppConfigSchema,
} from "../config/index.ts";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TOML = require("@iarna/toml");

describe("AppConfigSchema", () => {
  test("parses empty config with defaults", () => {
    const config = AppConfigSchema.parse({});
    expect(config.default_engine).toBe("opencode");
    expect(config.projects).toEqual({});
    expect(config.telegram.allowed_users).toEqual([]);
  });

  test("parses full config", () => {
    const config = AppConfigSchema.parse({
      default_engine: "opencode",
      default_project: "myproject",
      system_prompt: "You are helpful",
      telegram: { bot_token: "123:abc", allowed_users: [111, 222] },
      projects: {
        myproject: {
          alias: "myproject",
          path: "/home/user/project",
        },
      },
    });
    expect(config.default_project).toBe("myproject");
    expect(config.telegram.bot_token).toBe("123:abc");
  });
});

describe("Config I/O", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "yee88-config-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loadAppConfig with missing file returns defaults", () => {
    const { config } = loadAppConfig(join(tmpDir, "nonexistent.toml"));
    expect(config.default_engine).toBe("opencode");
  });

  test("loadAppConfig reads TOML file", () => {
    const cfgPath = join(tmpDir, "test.toml");
    writeFileSync(
      cfgPath,
      TOML.stringify({
        default_engine: "opencode",
        default_project: "test",
        projects: {
          test: { alias: "test", path: "/tmp/test" },
        },
      })
    );
    const { config } = loadAppConfig(cfgPath);
    expect(config.default_project).toBe("test");
    expect(config.projects["test"]?.path).toBe("/tmp/test");
  });

  test("writeConfig creates file", () => {
    const cfgPath = join(tmpDir, "sub", "config.toml");
    writeConfig({ default_engine: "opencode" }, cfgPath);
    const { config } = loadAppConfig(cfgPath);
    expect(config.default_engine).toBe("opencode");
  });
});

describe("Project helpers", () => {
  const config: AppConfig = {
    default_engine: "opencode",
    default_project: "main",
    system_prompt: "global prompt",
    show_actions: false,
    debug: false,
    telegram: { allowed_users: [] },
    dingtalk: { reply_mode: "ai_card" as const, allowed_users: [] },
    projects: {
      main: {
        alias: "main",
        path: "/home/user/main",
        worktrees_dir: ".worktrees",
        chat_id: 12345,
        system_prompt: "project prompt",
      },
      other: {
        alias: "other",
        path: "/home/user/other",
        worktrees_dir: ".worktrees",
      },
    },
  };

  test("resolveProject by alias", () => {
    expect(resolveProject(config, "main")?.path).toBe("/home/user/main");
  });

  test("resolveProject uses default", () => {
    expect(resolveProject(config)?.alias).toBe("main");
  });

  test("resolveProject returns undefined for unknown", () => {
    expect(resolveProject(config, "unknown")).toBeUndefined();
  });

  test("resolveSystemPrompt prefers project prompt", () => {
    expect(resolveSystemPrompt(config, "main")).toBe("project prompt");
  });

  test("resolveSystemPrompt falls back to global", () => {
    expect(resolveSystemPrompt(config, "other")).toBe("global prompt");
  });

  test("projectForChat finds project by chat_id", () => {
    expect(projectForChat(config, 12345)).toBe("main");
  });

  test("projectForChat returns undefined for unknown", () => {
    expect(projectForChat(config, 99999)).toBeUndefined();
  });
});