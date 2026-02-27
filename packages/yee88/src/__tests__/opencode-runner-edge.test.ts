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
});