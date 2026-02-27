// src/__tests__/bot.test.ts
import { test, expect, describe } from "bun:test";
import { createBot } from "../chat/bot.ts";
import type { AppConfig } from "../config/index.ts";

describe("createBot", () => {
  test("throws without bot token", () => {
    const config: AppConfig = {
      default_engine: "opencode",
      telegram: { allowed_users: [] },
      projects: {},
    };
    expect(() => createBot(config)).toThrow("Missing telegram.bot_token");
  });

  test("creates bot with valid config", () => {
    const config: AppConfig = {
      default_engine: "opencode",
      telegram: { bot_token: "123:test", allowed_users: [] },
      projects: {},
    };
    const { chat, runner, sessionStore, stateAdapter } = createBot(config);
    expect(chat).toBeDefined();
    expect(runner).toBeDefined();
    expect(sessionStore).toBeDefined();
    expect(stateAdapter).toBeDefined();
  });
});