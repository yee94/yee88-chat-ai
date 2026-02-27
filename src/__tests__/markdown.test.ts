// src/__tests__/markdown.test.ts
import { test, expect, describe } from "bun:test";
import {
  formatElapsed,
  formatHeader,
  shorten,
  actionStatus,
  actionSuffix,
  splitMarkdownBody,
  trimBody,
  assembleMarkdownParts,
  prepareMultiMessage,
} from "../markdown/index.ts";

describe("formatElapsed", () => {
  test("seconds only", () => {
    expect(formatElapsed(5)).toBe("5s");
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(59)).toBe("59s");
  });

  test("minutes and seconds", () => {
    expect(formatElapsed(60)).toBe("1m 00s");
    expect(formatElapsed(90)).toBe("1m 30s");
    expect(formatElapsed(3599)).toBe("59m 59s");
  });

  test("hours and minutes", () => {
    expect(formatElapsed(3600)).toBe("1h 00m");
    expect(formatElapsed(3661)).toBe("1h 01m");
  });

  test("negative values clamp to 0", () => {
    expect(formatElapsed(-5)).toBe("0s");
  });
});

describe("formatHeader", () => {
  test("basic header", () => {
    expect(formatHeader(5, null, { label: "▸", engine: "opencode" })).toBe(
      "▸ · opencode · 5s"
    );
  });

  test("header with step", () => {
    expect(formatHeader(65, 3, { label: "▸", engine: "opencode" })).toBe(
      "▸ · opencode · 1m 05s · step 3"
    );
  });
});

describe("shorten", () => {
  test("returns full text if within width", () => {
    expect(shorten("hello", 10)).toBe("hello");
  });

  test("truncates with ellipsis", () => {
    expect(shorten("hello world", 6)).toBe("hello…");
  });

  test("no width returns full text", () => {
    expect(shorten("hello")).toBe("hello");
  });
});

describe("actionStatus", () => {
  test("running", () => {
    expect(actionStatus(false)).toBe("▸");
  });

  test("completed ok", () => {
    expect(actionStatus(true, true)).toBe("✓");
  });

  test("completed fail", () => {
    expect(actionStatus(true, false)).toBe("✗");
  });

  test("completed with non-zero exit", () => {
    expect(actionStatus(true, undefined, 1)).toBe("✗");
  });

  test("completed with zero exit", () => {
    expect(actionStatus(true, undefined, 0)).toBe("✓");
  });
});

describe("actionSuffix", () => {
  test("no exit code", () => {
    expect(actionSuffix()).toBe("");
  });

  test("zero exit code", () => {
    expect(actionSuffix(0)).toBe("");
  });

  test("non-zero exit code", () => {
    expect(actionSuffix(1)).toBe(" (exit 1)");
  });
});

describe("splitMarkdownBody", () => {
  test("empty body returns empty", () => {
    expect(splitMarkdownBody("", 100)).toEqual([]);
    expect(splitMarkdownBody("  ", 100)).toEqual([]);
  });

  test("short body returns single chunk", () => {
    expect(splitMarkdownBody("hello", 100)).toEqual(["hello"]);
  });

  test("splits long body", () => {
    const body = "a\n\n".repeat(100); // 200 chars with paragraph breaks
    const chunks = splitMarkdownBody(body, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200); // some overhead allowed
    }
  });

  test("preserves code fences across splits", () => {
    const body = "```js\n" + "x\n".repeat(100) + "```";
    const chunks = splitMarkdownBody(body, 50);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should have opening fence
    expect(chunks[0]).toContain("```js");
  });
});

describe("trimBody", () => {
  test("returns undefined for empty", () => {
    expect(trimBody("")).toBeUndefined();
    expect(trimBody(undefined)).toBeUndefined();
  });

  test("truncates long body", () => {
    const body = "a".repeat(4000);
    const result = trimBody(body, 100);
    expect(result!.length).toBe(100);
    expect(result!.endsWith("…")).toBe(true);
  });

  test("returns body if within limit", () => {
    expect(trimBody("hello", 100)).toBe("hello");
  });
});

describe("assembleMarkdownParts", () => {
  test("joins parts with double newline", () => {
    expect(assembleMarkdownParts({ header: "H", body: "B", footer: "F" })).toBe(
      "H\n\nB\n\nF"
    );
  });

  test("skips undefined parts", () => {
    expect(assembleMarkdownParts({ header: "H" })).toBe("H");
    expect(assembleMarkdownParts({ header: "H", body: "B" })).toBe("H\n\nB");
  });
});

describe("prepareMultiMessage", () => {
  test("single short message", () => {
    const result = prepareMultiMessage({ header: "H", body: "B" });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("H\n\nB");
  });

  test("adds continuation headers for splits", () => {
    const body = "a\n\n".repeat(500);
    const result = prepareMultiMessage({ header: "H", body }, 100);
    expect(result.length).toBeGreaterThan(1);
    expect(result[1]).toContain("continued");
  });
});