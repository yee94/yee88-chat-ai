// src/__tests__/startup.test.ts
import { test, expect, describe } from "bun:test";
import { generateStartupMessage } from "../chat/startup.ts";
import type { AppConfig } from "../config/index.ts";

describe("generateStartupMessage", () => {
  test("generates message with defaults", async () => {
    const config: AppConfig = {
      default_engine: "opencode",
      show_actions: false,
      debug: false,
      telegram: { allowed_users: [] },
      dingtalk: { reply_mode: "ai_card" as const, allowed_users: [] },
      projects: {},
    };
    const msg = await generateStartupMessage(config);
    expect(msg).toContain("yee88 bot started");
    expect(msg).toContain("opencode");
    expect(msg).toContain("No projects registered");
    expect(msg).toContain("all (no restriction)");
    expect(msg).toContain("CWD");
  });

  test("generates message with projects", async () => {
    const config: AppConfig = {
      default_engine: "opencode",
      default_project: "main",
      show_actions: false,
      debug: false,
      telegram: { allowed_users: [111] },
      dingtalk: { reply_mode: "ai_card" as const, allowed_users: [] },
      projects: {
        main: {
          alias: "main",
          path: "/home/user/main",
          worktrees_dir: ".worktrees",
        },
      },
    };
    const msg = await generateStartupMessage(config);
    expect(msg).toContain("main");
    expect(msg).toContain("/home/user/main");
    expect(msg).toContain("(default)");
    expect(msg).toContain("1 configured");
  });
});