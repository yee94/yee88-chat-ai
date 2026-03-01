// src/__tests__/guard.test.ts
import { test, expect, describe } from "bun:test";
import { isAuthorized, unauthorizedMessage } from "../chat/guard.ts";
import type { AppConfig } from "../config/index.ts";

function mockMessage(userId: string | number) {
  return {
    text: "hello",
    author: {
      userId: String(userId),
      userName: "testuser",
      isMe: false,
    },
  } as any;
}

describe("isAuthorized", () => {
  test("allows all when allowed_users is empty", () => {
    const config: AppConfig = {
      default_engine: "opencode",
      show_actions: false,
      debug: false,
      telegram: { allowed_users: [] },
      dingtalk: { reply_mode: "ai_card" as const, allowed_users: [] },
      projects: {},
    };
    expect(isAuthorized(mockMessage(12345), config)).toBe(true);
    expect(isAuthorized(mockMessage(99999), config)).toBe(true);
  });

  test("allows listed users", () => {
    const config: AppConfig = {
      default_engine: "opencode",
      show_actions: false,
      debug: false,
      telegram: { allowed_users: [111, 222] },
      dingtalk: { reply_mode: "ai_card" as const, allowed_users: [] },
      projects: {},
    };
    expect(isAuthorized(mockMessage(111), config)).toBe(true);
    expect(isAuthorized(mockMessage("222"), config)).toBe(true);
  });

  test("rejects unlisted users", () => {
    const config: AppConfig = {
      default_engine: "opencode",
      show_actions: false,
      debug: false,
      telegram: { allowed_users: [111, 222] },
      dingtalk: { reply_mode: "ai_card" as const, allowed_users: [] },
      projects: {},
    };
    expect(isAuthorized(mockMessage(333), config)).toBe(false);
    expect(isAuthorized(mockMessage("999"), config)).toBe(false);
  });

  test("rejects non-numeric userId", () => {
    const config: AppConfig = {
      default_engine: "opencode",
      show_actions: false,
      debug: false,
      telegram: { allowed_users: [111] },
      dingtalk: { reply_mode: "ai_card" as const, allowed_users: [] },
      projects: {},
    };
    expect(isAuthorized(mockMessage("abc"), config)).toBe(false);
  });
});

describe("unauthorizedMessage", () => {
  test("returns warning message", () => {
    const msg = unauthorizedMessage();
    expect(msg).toContain("权限");
    expect(msg).toContain("allowed_users");
  });
});