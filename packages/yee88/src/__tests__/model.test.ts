// src/__tests__/model.test.ts
import { test, expect, describe } from "bun:test";
import {
  createStartedEvent,
  createActionEvent,
  createTextEvent,
  createCompletedEvent,
  type ResumeToken,
  type Action,
} from "../model.ts";

describe("model", () => {
  const resume: ResumeToken = { engine: "opencode", value: "ses_abc123" };
  const action: Action = {
    id: "call_1",
    kind: "tool",
    title: "read file",
    detail: { path: "/foo.ts" },
  };

  test("createStartedEvent sets type", () => {
    const evt = createStartedEvent({ engine: "opencode", resume, title: "test" });
    expect(evt.type).toBe("started");
    expect(evt.engine).toBe("opencode");
    expect(evt.resume).toEqual(resume);
  });

  test("createActionEvent sets type", () => {
    const evt = createActionEvent({
      engine: "opencode",
      action,
      phase: "started",
    });
    expect(evt.type).toBe("action");
    expect(evt.action.kind).toBe("tool");
  });

  test("createCompletedEvent sets type", () => {
    const evt = createCompletedEvent({
      engine: "opencode",
      ok: true,
      answer: "done",
      resume,
    });
    expect(evt.type).toBe("completed");
    expect(evt.ok).toBe(true);
    expect(evt.resume).toEqual(resume);
  });

  test("createTextEvent sets type", () => {
    const evt = createTextEvent({
      engine: "opencode",
      delta: "hello",
      accumulated: "hello",
    });
    expect(evt.type).toBe("text");
    expect(evt.engine).toBe("opencode");
    expect(evt.delta).toBe("hello");
    expect(evt.accumulated).toBe("hello");
  });

  test("createCompletedEvent with error", () => {
    const evt = createCompletedEvent({
      engine: "opencode",
      ok: false,
      answer: "",
      error: "something failed",
    });
    expect(evt.ok).toBe(false);
    expect(evt.error).toBe("something failed");
  });
});