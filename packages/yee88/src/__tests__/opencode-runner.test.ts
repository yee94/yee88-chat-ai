// src/__tests__/opencode-runner.test.ts
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

describe("translateEvent", () => {
  test("step_start emits StartedEvent on first occurrence with sessionId", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "step_start",
      sessionID: "ses_abc123",
      part: {},
    };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("started");
    if (events[0]!.type === "started") {
      expect(events[0]!.resume.value).toBe("ses_abc123");
    }
    expect(state.emittedStarted).toBe(true);
    expect(state.sessionId).toBe("ses_abc123");
  });

  test("step_start without sessionId does not emit", () => {
    const state = makeState();
    const event: OpenCodeEvent = { type: "step_start" };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(0);
  });

  test("duplicate step_start does not emit again", () => {
    const state = makeState();
    state.sessionId = "ses_abc123";
    state.emittedStarted = true;
    const event: OpenCodeEvent = { type: "step_start", sessionID: "ses_abc123" };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(0);
  });

  test("tool_use with pending status emits action started", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "tool_use",
      sessionID: "ses_abc",
      part: {
        tool: "read_file",
        callID: "call_1",
        state: {
          input: { file_path: "/foo.ts" },
          status: "pending",
        },
      },
    };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("action");
    if (events[0]!.type === "action") {
      expect(events[0]!.phase).toBe("started");
      expect(events[0]!.action.id).toBe("call_1");
    }
  });

  test("tool_use with completed status emits action completed", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "tool_use",
      part: {
        tool: "read_file",
        callID: "call_1",
        state: {
          input: { file_path: "/foo.ts" },
          status: "completed",
          output: "file contents here",
          metadata: { exit: 0 },
        },
      },
    };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(1);
    if (events[0]!.type === "action") {
      expect(events[0]!.phase).toBe("completed");
      expect(events[0]!.ok).toBe(true);
    }
  });

  test("tool_use with non-zero exit code marks as error", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "tool_use",
      part: {
        tool: "bash",
        callID: "call_2",
        state: {
          input: { command: "exit 1" },
          status: "completed",
          metadata: { exit: 1 },
        },
      },
    };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(1);
    if (events[0]!.type === "action") {
      expect(events[0]!.ok).toBe(false);
    }
  });

  test("tool_use with error status", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "tool_use",
      part: {
        tool: "bash",
        callID: "call_3",
        state: {
          input: { command: "fail" },
          status: "error",
          error: "command not found",
        },
      },
    };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(1);
    if (events[0]!.type === "action") {
      expect(events[0]!.phase).toBe("completed");
      expect(events[0]!.ok).toBe(false);
      expect(events[0]!.message).toBe("command not found");
    }
  });

  test("text events accumulate in state and emit TextEvent", () => {
    const state = makeState();
    const events1 = translateEvent({ type: "text", part: { text: "Hello " } }, "test", state);
    expect(events1).toHaveLength(1);
    expect(events1[0]!.type).toBe("text");
    if (events1[0]!.type === "text") {
      expect(events1[0]!.delta).toBe("Hello ");
      expect(events1[0]!.accumulated).toBe("Hello ");
    }

    const events2 = translateEvent({ type: "text", part: { text: "world" } }, "test", state);
    expect(events2).toHaveLength(1);
    if (events2[0]!.type === "text") {
      expect(events2[0]!.delta).toBe("world");
      expect(events2[0]!.accumulated).toBe("Hello world");
    }
    expect(state.lastText).toBe("Hello world");
  });

  test("step_finish with stop emits completed", () => {
    const state = makeState();
    state.sessionId = "ses_abc";
    state.lastText = "final answer";
    const event: OpenCodeEvent = {
      type: "step_finish",
      part: { reason: "stop" },
    };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(1);
    if (events[0]!.type === "completed") {
      expect(events[0]!.ok).toBe(true);
      expect(events[0]!.answer).toBe("final answer");
      expect(events[0]!.resume?.value).toBe("ses_abc");
    }
  });

  test("step_finish with tool-calls does not emit completed", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "step_finish",
      part: { reason: "tool-calls" },
    };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(0);
  });

  test("error event emits completed with error", () => {
    const state = makeState();
    state.sessionId = "ses_abc";
    const event: OpenCodeEvent = {
      type: "error",
      error: "rate limit exceeded",
      message: "rate limit exceeded",
    };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(1);
    if (events[0]!.type === "completed") {
      expect(events[0]!.ok).toBe(false);
      expect(events[0]!.error).toBe("rate limit exceeded");
    }
  });

  test("error event with object message extracts data.message", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "error",
      message: { data: { message: "nested error" } },
    };
    const events = translateEvent(event, "test", state);
    if (events[0]!.type === "completed") {
      expect(events[0]!.error).toBe("nested error");
    }
  });

  test("tool_use without callID returns empty", () => {
    const state = makeState();
    const event: OpenCodeEvent = {
      type: "tool_use",
      part: { tool: "read_file", state: { input: {} } },
    };
    const events = translateEvent(event, "test", state);
    expect(events).toHaveLength(0);
  });
});

describe("OpenCodeRunner", () => {
  const { OpenCodeRunner } = require("../runner/opencode.ts");

  test("isResumeLine matches valid resume lines", () => {
    const runner = new OpenCodeRunner();
    expect(runner.isResumeLine("opencode --session ses_abc123")).toBe(true);
    expect(runner.isResumeLine("opencode run --session ses_abc123")).toBe(true);
    expect(runner.isResumeLine("`opencode --session ses_abc123`")).toBe(true);
    expect(runner.isResumeLine("opencode -s ses_abc123")).toBe(true);
  });

  test("isResumeLine rejects invalid lines", () => {
    const runner = new OpenCodeRunner();
    expect(runner.isResumeLine("hello world")).toBe(false);
    expect(runner.isResumeLine("opencode --model gpt-4")).toBe(false);
  });

  test("formatResume formats correctly", () => {
    const runner = new OpenCodeRunner();
    const result = runner.formatResume({ engine: "opencode", value: "ses_abc123" });
    expect(result).toBe("`opencode --session ses_abc123`");
  });

  test("formatResume throws for wrong engine", () => {
    const runner = new OpenCodeRunner();
    expect(() => runner.formatResume({ engine: "claude", value: "ses_abc" })).toThrow();
  });

  test("extractResume extracts token from text", () => {
    const runner = new OpenCodeRunner();
    const result = runner.extractResume("run: opencode --session ses_abc123");
    expect(result).toEqual({ engine: "opencode", value: "ses_abc123" });
  });

  test("extractResume returns null for no match", () => {
    const runner = new OpenCodeRunner();
    expect(runner.extractResume("no resume here")).toBeNull();
    expect(runner.extractResume(null)).toBeNull();
  });

  test("extractResume returns last match", () => {
    const runner = new OpenCodeRunner();
    const text = "opencode --session ses_first\nopencode --session ses_last";
    const result = runner.extractResume(text);
    expect(result?.value).toBe("ses_last");
  });
});