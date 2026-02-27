// src/__tests__/integration.test.ts
import { test, expect, describe } from "bun:test";
import { OpenCodeRunner } from "../runner/opencode.ts";
import { SessionStore } from "../session/store.ts";
import { SessionLockManager } from "../session/lock.ts";
import { ThreadScheduler } from "../scheduler/index.ts";
import { MemoryStateAdapter } from "../chat/state.ts";
import { loadAppConfig, AppConfigSchema } from "../config/index.ts";
import {
  formatElapsed,
  formatHeader,
  splitMarkdownBody,
  prepareMultiMessage,
} from "../markdown/index.ts";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Integration: Config → SessionStore → Runner", () => {
  test("full config parse and session flow", () => {
    const config = AppConfigSchema.parse({
      default_engine: "opencode",
      telegram: { bot_token: "123:abc", allowed_users: [111] },
      projects: {
        test: { alias: "test", path: "/tmp/test" },
      },
    });

    expect(config.default_engine).toBe("opencode");
    expect(config.telegram.bot_token).toBe("123:abc");

    const tmpDir = mkdtempSync(join(tmpdir(), "yee88-int-"));
    try {
      const store = new SessionStore(join(tmpDir, "sessions.json"));
      const token = { engine: "opencode", value: "ses_abc123" };

      store.setSessionResume("chat1", null, token);
      const resume = store.getSessionResume("chat1", null, "opencode");
      expect(resume).toEqual(token);

      const runner = new OpenCodeRunner();
      expect(runner.formatResume(token)).toBe("`opencode --session ses_abc123`");
      expect(runner.extractResume("opencode --session ses_abc123")).toEqual(token);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Integration: Scheduler → Lock", () => {
  test("scheduler with lock manager", async () => {
    const lockManager = new SessionLockManager();
    const executed: string[] = [];

    const scheduler = new ThreadScheduler(async (job) => {
      await lockManager.withLock(job.resumeToken, async () => {
        executed.push(job.text);
        await Bun.sleep(10);
      });
    });

    const token = { engine: "opencode", value: "ses_abc" };
    await scheduler.enqueue({
      chatId: "c1",
      userMsgId: "m1",
      text: "first",
      resumeToken: token,
    });
    await scheduler.enqueue({
      chatId: "c1",
      userMsgId: "m2",
      text: "second",
      resumeToken: token,
    });

    await Bun.sleep(100);
    expect(executed).toEqual(["first", "second"]);
  });
});

describe("Integration: Markdown → Multi-message", () => {
  test("long answer splits correctly", () => {
    const longBody = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: ${"x".repeat(80)}`).join(
      "\n\n"
    );

    const messages = prepareMultiMessage(
      {
        header: "✓ · opencode · 15s",
        body: longBody,
        footer: "▸ read_file\n✓ write_file",
      },
      500
    );

    expect(messages.length).toBeGreaterThan(1);
    expect(messages[0]).toContain("✓ · opencode · 15s");
    expect(messages[1]).toContain("continued");
  });

  test("progress header formatting", () => {
    const header = formatHeader(125, 3, { label: "▸", engine: "opencode" });
    expect(header).toBe("▸ · opencode · 2m 05s · step 3");
  });
});

describe("Integration: MemoryStateAdapter full lifecycle", () => {
  test("subscribe → lock → state → unsubscribe", async () => {
    const state = new MemoryStateAdapter();
    await state.connect();

    // Subscribe
    await state.subscribe("thread1");
    expect(await state.isSubscribed("thread1")).toBe(true);

    // Lock
    const lock = await state.acquireLock("thread1", 5000);
    expect(lock).not.toBeNull();

    // State
    await state.set("thread1:state", { mode: "ai" });
    expect(await state.get<{ mode: string }>("thread1:state")).toEqual({ mode: "ai" });

    // Extend lock
    expect(await state.extendLock(lock!, 10000)).toBe(true);

    // Release lock
    await state.releaseLock(lock!);

    // Unsubscribe
    await state.unsubscribe("thread1");
    expect(await state.isSubscribed("thread1")).toBe(false);

    await state.disconnect();
  });
});