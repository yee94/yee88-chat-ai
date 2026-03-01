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
    expect(header).toBe("▸ · step 3");
  });
});

describe("Integration: Multi-step agent event flow (bailian/MiniMax-M2.5)", () => {
  // 模拟 MiniMax-M2.5 模型的典型多轮 agent 行为：
  // 思考 → 工具调用 → 思考 → 工具调用 → 最终回答
  const { translateEvent } = require("../runner/opencode.ts");

  function makeState() {
    return {
      pendingActions: new Map(),
      lastText: null as string | null,
      noteSeq: 0,
      sessionId: null as string | null,
      emittedStarted: false,
      sawStepFinish: false,
    };
  }

  test("full multi-step flow produces correct text_finished and completed events", () => {
    const state = makeState();
    const allEvents: Array<{ type: string; [key: string]: unknown }> = [];

    const collect = (event: any) => {
      const events = translateEvent(event, "test", state, "bailian/MiniMax-M2.5");
      allEvents.push(...events);
      return events;
    };

    // Step 1: agent 开始思考
    collect({ type: "step_start", sessionID: "ses_minimax_001" });
    collect({ type: "text", part: { text: "让我先查看一下" } });
    collect({ type: "text", part: { text: "项目结构..." } });
    // agent 决定调用工具
    collect({ type: "step_finish", part: { reason: "tool-calls" } });

    // 工具执行
    collect({
      type: "tool_use",
      sessionID: "ses_minimax_001",
      part: {
        tool: "read_file",
        callID: "call_001",
        state: { input: { file_path: "/src/index.ts" }, status: "pending" },
      },
    });
    collect({
      type: "tool_use",
      sessionID: "ses_minimax_001",
      part: {
        tool: "read_file",
        callID: "call_001",
        state: {
          input: { file_path: "/src/index.ts" },
          status: "completed",
          output: "export default {}",
          metadata: { exit: 0 },
        },
      },
    });

    // Step 2: agent 再次思考
    collect({ type: "step_start", sessionID: "ses_minimax_001" });
    collect({ type: "text", part: { text: "看完代码后，" } });
    collect({ type: "text", part: { text: "我需要修改这个文件" } });
    collect({ type: "step_finish", part: { reason: "tool-calls" } });

    // 工具执行
    collect({
      type: "tool_use",
      sessionID: "ses_minimax_001",
      part: {
        tool: "edit",
        callID: "call_002",
        state: { input: { file_path: "/src/index.ts" }, status: "pending" },
      },
    });
    collect({
      type: "tool_use",
      sessionID: "ses_minimax_001",
      part: {
        tool: "edit",
        callID: "call_002",
        state: {
          input: { file_path: "/src/index.ts" },
          status: "completed",
          output: "ok",
          metadata: { exit: 0 },
        },
      },
    });

    // Step 3: 最终回答
    collect({ type: "step_start", sessionID: "ses_minimax_001" });
    collect({ type: "text", part: { text: "修改完成！以下是变更摘要。" } });
    collect({ type: "step_finish", part: { reason: "stop" } });

    // 验证事件流
    const textFinished = allEvents.filter((e) => e.type === "text_finished");
    const completed = allEvents.filter((e) => e.type === "completed");
    const started = allEvents.filter((e) => e.type === "started");
    const actions = allEvents.filter((e) => e.type === "action");

    // 应该有 1 个 started
    expect(started).toHaveLength(1);

    // 应该有 2 个 text_finished（Step 1 和 Step 2 各一个）
    expect(textFinished).toHaveLength(2);
    expect((textFinished[0] as any).text).toBe("让我先查看一下项目结构...");
    expect((textFinished[1] as any).text).toBe("看完代码后，我需要修改这个文件");

    // 应该有 4 个 action（2 started + 2 completed）
    expect(actions).toHaveLength(4);

    // 应该有 1 个 completed，answer 只包含最后一轮的文本
    expect(completed).toHaveLength(1);
    expect((completed[0] as any).answer).toBe("修改完成！以下是变更摘要。");
    expect((completed[0] as any).ok).toBe(true);
  });

  test("agent with no intermediate text (direct tool calls) works correctly", () => {
    const state = makeState();
    const allEvents: Array<{ type: string; [key: string]: unknown }> = [];

    const collect = (event: any) => {
      const events = translateEvent(event, "test", state, "bailian/MiniMax-M2.5");
      allEvents.push(...events);
    };

    // Step 1: 直接调用工具，没有思考文本
    collect({ type: "step_start", sessionID: "ses_minimax_002" });
    collect({ type: "step_finish", part: { reason: "tool-calls" } });

    // 工具执行
    collect({
      type: "tool_use",
      part: {
        tool: "bash",
        callID: "call_003",
        state: { input: { command: "ls" }, status: "completed", output: "files", metadata: { exit: 0 } },
      },
    });

    // Step 2: 最终回答
    collect({ type: "step_start", sessionID: "ses_minimax_002" });
    collect({ type: "text", part: { text: "目录内容如上" } });
    collect({ type: "step_finish", part: { reason: "stop" } });

    const textFinished = allEvents.filter((e) => e.type === "text_finished");
    const completed = allEvents.filter((e) => e.type === "completed");

    // 没有中间文本，不应该有 text_finished
    expect(textFinished).toHaveLength(0);

    // 最终 answer 正确
    expect(completed).toHaveLength(1);
    expect((completed[0] as any).answer).toBe("目录内容如上");
  });

  test("agent with single step (no tool calls) works correctly", () => {
    const state = makeState();
    const allEvents: Array<{ type: string; [key: string]: unknown }> = [];

    const collect = (event: any) => {
      const events = translateEvent(event, "test", state, "bailian/MiniMax-M2.5");
      allEvents.push(...events);
    };

    // 单步直接回答
    collect({ type: "step_start", sessionID: "ses_minimax_003" });
    collect({ type: "text", part: { text: "你好！我是 AI 助手。" } });
    collect({ type: "step_finish", part: { reason: "stop" } });

    const textFinished = allEvents.filter((e) => e.type === "text_finished");
    const completed = allEvents.filter((e) => e.type === "completed");

    // 没有 tool-calls，不应该有 text_finished
    expect(textFinished).toHaveLength(0);

    // 最终 answer 正确
    expect(completed).toHaveLength(1);
    expect((completed[0] as any).answer).toBe("你好！我是 AI 助手。");
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