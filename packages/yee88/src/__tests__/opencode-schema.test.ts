// src/__tests__/opencode-schema.test.ts
import { test, expect, describe } from "bun:test";
import { decodeEvent, OpenCodeEventSchema } from "../schema/opencode.ts";

describe("OpenCode JSONL Schema", () => {
  test("decodes step_start event", () => {
    const line = JSON.stringify({
      type: "step_start",
      timestamp: 1234567890,
      sessionID: "ses_abc123",
      part: { some: "data" },
    });
    const evt = decodeEvent(line);
    expect(evt.type).toBe("step_start");
    expect(evt.sessionID).toBe("ses_abc123");
  });

  test("decodes step_finish event", () => {
    const line = JSON.stringify({
      type: "step_finish",
      sessionID: "ses_abc123",
      part: { reason: "stop" },
    });
    const evt = decodeEvent(line);
    expect(evt.type).toBe("step_finish");
  });

  test("decodes tool_use event", () => {
    const line = JSON.stringify({
      type: "tool_use",
      sessionID: "ses_abc123",
      part: {
        tool: "read_file",
        callID: "call_1",
        state: { input: { file_path: "/foo.ts" }, status: "completed" },
      },
    });
    const evt = decodeEvent(line);
    expect(evt.type).toBe("tool_use");
    expect(evt.type === "tool_use" && evt.part?.["tool"]).toBe("read_file");
  });

  test("decodes text event", () => {
    const line = JSON.stringify({
      type: "text",
      sessionID: "ses_abc123",
      part: { text: "Hello world" },
    });
    const evt = decodeEvent(line);
    expect(evt.type).toBe("text");
  });

  test("decodes error event", () => {
    const line = JSON.stringify({
      type: "error",
      sessionID: "ses_abc123",
      error: "something went wrong",
      message: "error message",
    });
    const evt = decodeEvent(line);
    expect(evt.type).toBe("error");
  });

  test("decodes Uint8Array input", () => {
    const line = new TextEncoder().encode(
      JSON.stringify({ type: "text", part: { text: "hi" } })
    );
    const evt = decodeEvent(line);
    expect(evt.type).toBe("text");
  });

  test("throws on invalid JSON", () => {
    expect(() => decodeEvent("not json")).toThrow();
  });

  test("throws on unknown event type", () => {
    expect(() =>
      decodeEvent(JSON.stringify({ type: "unknown_type" }))
    ).toThrow();
  });

  test("handles null fields gracefully", () => {
    const line = JSON.stringify({
      type: "step_start",
      timestamp: null,
      sessionID: null,
      part: null,
    });
    const evt = decodeEvent(line);
    expect(evt.type).toBe("step_start");
    expect(evt.timestamp).toBeNull();
  });

  test("handles missing optional fields", () => {
    const line = JSON.stringify({ type: "text" });
    const evt = decodeEvent(line);
    expect(evt.type).toBe("text");
    expect(evt.sessionID).toBeUndefined();
  });
});