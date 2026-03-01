// src/__tests__/opencode-runner-edge.test.ts
import { test, expect, describe } from "bun:test";
import { translateEvent } from "../runner/opencode.ts";
import type { OpenCodeEvent } from "../schema/opencode.ts";

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

describe("translateEvent edge cases", () => {
  test("tool_use with file_change kind includes changes in detail", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "tool_use",
      part: {
        tool: "write_file",
        callID: "call_1",
        state: {
          input: { file_path: "/src/app.ts" },
          status: "pending",
        },
      },
    };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(1);
    if (events[0]!.type === "action") {
      expect(events[0]!.action.kind).toBe("file_change");
      expect(events[0]!.action.detail["changes"]).toBeDefined();
    }
  });

  test("tool_use with command kind extracts command", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "tool_use",
      part: {
        tool: "bash",
        callID: "call_1",
        state: {
          input: { command: "ls -la" },
          status: "pending",
        },
      },
    };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(1);
    if (events[0]!.type === "action") {
      expect(events[0]!.action.kind).toBe("command");
      expect(events[0]!.action.title).toContain("ls -la");
    }
  });

  test("tool_use with long command truncates", () => {
    const state = makeState();
    const longCmd = "a".repeat(100);
    const event: OpenCodeEvent = {
      type: "tool_use",
      part: {
        tool: "bash",
        callID: "call_1",
        state: {
          input: { command: longCmd },
          status: "pending",
        },
      },
    };
    const events = translateEvent(event, "test", state);
    if (events[0]!.type === "action") {
      expect(events[0]!.action.title.length).toBeLessThan(100);
    }
  });

  test("tool_use with web_search kind", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "tool_use",
      part: {
        tool: "web_search",
        callID: "call_1",
        state: {
          input: { query: "test" },
          status: "pending",
        },
      },
    };
    const events = translateEvent(event, "test", state);
    if (events[0]!.type === "action") {
      expect(events[0]!.action.kind).toBe("web_search");
    }
  });

  test("tool_use with task/agent kind", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "tool_use",
      part: {
        tool: "task_runner",
        callID: "call_1",
        state: {
          input: {},
          status: "pending",
        },
      },
    };
    const events = translateEvent(event, "test", state);
    if (events[0]!.type === "action") {
      expect(events[0]!.action.kind).toBe("subagent");
    }
  });

  test("tool_use with state title overrides computed title", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "tool_use",
      part: {
        tool: "read_file",
        callID: "call_1",
        state: {
          input: { file_path: "/foo.ts" },
          status: "pending",
          title: "Custom Title",
        },
      },
    };
    const events = translateEvent(event, "test", state);
    if (events[0]!.type === "action") {
      expect(events[0]!.action.title).toBe("Custom Title");
    }
  });

  test("tool_use completed with output preview", () => {
    const state = makeState();
    const longOutput = "x".repeat(600);
    const event: OpenCodeEvent = {
      type: "tool_use",
      part: {
        tool: "read_file",
        callID: "call_1",
        state: {
          input: { file_path: "/foo.ts" },
          status: "completed",
          output: longOutput,
          metadata: { exit: 0 },
        },
      },
    };
    const events = translateEvent(event, "test", state);
    if (events[0]!.type === "action") {
      const preview = events[0]!.action.detail["output_preview"] as string;
      expect(preview.length).toBeLessThanOrEqual(500);
    }
  });

  test("error event with null message uses default", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "error",
      error: null,
      message: null,
    };
    const events = translateEvent(event, "test", state);
    if (events[0]!.type === "completed") {
      expect(events[0]!.error).toBe("opencode error");
    }
  });

  test("error event with object error extracts name", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "error",
      message: { name: "RateLimitError" },
    };
    const events = translateEvent(event, "test", state);
    if (events[0]!.type === "completed") {
      expect(events[0]!.error).toBe("RateLimitError");
    }
  });

  test("multiple text events concatenate", () => {
    const state = makeState();
    translateEvent({ type: "text", part: { text: "a" } }, "t", state);
    translateEvent({ type: "text", part: { text: "b" } }, "t", state);
    translateEvent({ type: "text", part: { text: "c" } }, "t", state);
    expect(state.lastText).toBe("abc");
  });

  test("text event with empty text is ignored", () => {
    const state = makeState();
    translateEvent({ type: "text", part: { text: "" } }, "t", state);
    expect(state.lastText).toBeNull();
  });

  test("text event with non-string text is ignored", () => {
    const state = makeState();
    translateEvent({ type: "text", part: { text: 123 } }, "t", state);
    expect(state.lastText).toBeNull();
  });

  test("step_finish without reason does not emit", () => {
    const state = makeState();
    const events = translateEvent({ type: "step_finish", part: {} }, "t", state);
    expect(events).toHaveLength(0);
    expect(state.sawStepFinish).toBe(true);
  });

  test("completed event includes accumulated text", () => {
    const state = makeState();
    state.sessionId = "ses_abc";
    translateEvent({ type: "text", part: { text: "Hello " } }, "t", state);
    translateEvent({ type: "text", part: { text: "World" } }, "t", state);
    const events = translateEvent(
      { type: "step_finish", part: { reason: "stop" } },
      "t",
      state
    );
    if (events[0]!.type === "completed") {
      expect(events[0]!.answer).toBe("Hello World");
    }
  });

  test("session ID captured from first event", () => {
    const state = makeState();
    translateEvent(
      { type: "step_start", sessionID: "ses_first" },
      "t",
      state
    );
    translateEvent(
      { type: "step_start", sessionID: "ses_second" },
      "t",
      state
    );
    // Should keep the first one
    expect(state.sessionId).toBe("ses_first");
  });

  test("tool_use with null part returns empty", () => {
    const state = makeState();
    const events = translateEvent(
      { type: "tool_use", part: null },
      "t",
      state
    );
    expect(events).toHaveLength(0);
  });

  test("step_start with null sessionID does not emit", () => {
    const state = makeState();
    const events = translateEvent(
      { type: "step_start", sessionID: null },
      "t",
      state
    );
    expect(events).toHaveLength(0);
  });

  // --- agent 多轮 step 分片文本测试 ---

  test("step_finish(tool-calls) emits text_finished with accumulated text and resets lastText", () => {
    const state = makeState();
    state.sessionId = "ses_abc";
    translateEvent({ type: "text", part: { text: "我来帮你" } }, "t", state);
    translateEvent({ type: "text", part: { text: "分析代码" } }, "t", state);

    const events = translateEvent(
      { type: "step_finish", part: { reason: "tool-calls" } },
      "t",
      state
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("text_finished");
    if (events[0]!.type === "text_finished") {
      expect(events[0]!.text).toBe("我来帮你分析代码");
    }
    // lastText 应该被重置
    expect(state.lastText).toBeNull();
  });

  test("step_finish(tool-calls) without text does not emit text_finished", () => {
    const state = makeState();
    state.sessionId = "ses_abc";
    // 没有 text 事件，直接 tool-calls
    const events = translateEvent(
      { type: "step_finish", part: { reason: "tool-calls" } },
      "t",
      state
    );
    expect(events).toHaveLength(0);
  });

  test("multi-step agent: each step text is independent, final answer is last step only", () => {
    const state = makeState();
    state.sessionId = "ses_abc";

    // Step 1: agent 思考 → tool-calls
    translateEvent({ type: "step_start", sessionID: "ses_abc" }, "t", state);
    translateEvent({ type: "text", part: { text: "第一轮思考" } }, "t", state);
    const step1Events = translateEvent(
      { type: "step_finish", part: { reason: "tool-calls" } },
      "t",
      state
    );
    expect(step1Events).toHaveLength(1);
    expect(step1Events[0]!.type).toBe("text_finished");
    if (step1Events[0]!.type === "text_finished") {
      expect(step1Events[0]!.text).toBe("第一轮思考");
    }
    expect(state.lastText).toBeNull();

    // Tool execution (不影响 lastText)
    translateEvent({
      type: "tool_use",
      part: { tool: "read_file", callID: "call_1", state: { input: { file_path: "/foo.ts" }, status: "completed", output: "content", metadata: { exit: 0 } } },
    }, "t", state);

    // Step 2: agent 再次思考 → tool-calls
    translateEvent({ type: "step_start", sessionID: "ses_abc" }, "t", state);
    translateEvent({ type: "text", part: { text: "第二轮思考" } }, "t", state);
    const step2Events = translateEvent(
      { type: "step_finish", part: { reason: "tool-calls" } },
      "t",
      state
    );
    expect(step2Events).toHaveLength(1);
    if (step2Events[0]!.type === "text_finished") {
      expect(step2Events[0]!.text).toBe("第二轮思考");
    }
    expect(state.lastText).toBeNull();

    // Tool execution
    translateEvent({
      type: "tool_use",
      part: { tool: "edit", callID: "call_2", state: { input: { file_path: "/bar.ts" }, status: "completed", output: "ok", metadata: { exit: 0 } } },
    }, "t", state);

    // Step 3: agent 最终回答 → stop
    translateEvent({ type: "step_start", sessionID: "ses_abc" }, "t", state);
    translateEvent({ type: "text", part: { text: "最终回答" } }, "t", state);
    const finalEvents = translateEvent(
      { type: "step_finish", part: { reason: "stop" } },
      "t",
      state
    );
    expect(finalEvents).toHaveLength(1);
    expect(finalEvents[0]!.type).toBe("completed");
    if (finalEvents[0]!.type === "completed") {
      // 最终 answer 只包含最后一轮的文本，不再是所有轮次的合并
      expect(finalEvents[0]!.answer).toBe("最终回答");
      expect(finalEvents[0]!.ok).toBe(true);
    }
  });

  test("multi-step: text accumulated within a step is correct", () => {
    const state = makeState();
    state.sessionId = "ses_abc";

    // Step 1: 多个 text delta
    translateEvent({ type: "step_start", sessionID: "ses_abc" }, "t", state);
    const t1 = translateEvent({ type: "text", part: { text: "Hello " } }, "t", state);
    expect(t1[0]!.type).toBe("text");
    if (t1[0]!.type === "text") {
      expect(t1[0]!.accumulated).toBe("Hello ");
    }

    const t2 = translateEvent({ type: "text", part: { text: "World" } }, "t", state);
    if (t2[0]!.type === "text") {
      expect(t2[0]!.accumulated).toBe("Hello World");
    }

    // tool-calls → text_finished + reset
    const fin = translateEvent(
      { type: "step_finish", part: { reason: "tool-calls" } },
      "t",
      state
    );
    if (fin[0]!.type === "text_finished") {
      expect(fin[0]!.text).toBe("Hello World");
    }

    // Step 2: 新的 text 从空开始累积
    translateEvent({ type: "step_start", sessionID: "ses_abc" }, "t", state);
    const t3 = translateEvent({ type: "text", part: { text: "New " } }, "t", state);
    if (t3[0]!.type === "text") {
      // accumulated 应该从新的 step 开始，不包含上一轮的内容
      expect(t3[0]!.accumulated).toBe("New ");
    }

    const t4 = translateEvent({ type: "text", part: { text: "Step" } }, "t", state);
    if (t4[0]!.type === "text") {
      expect(t4[0]!.accumulated).toBe("New Step");
    }
  });
});