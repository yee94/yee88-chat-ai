// src/__tests__/topic-context.test.ts
import { test, expect, describe } from "bun:test";
import {
  mergeTopicContext,
  formatContext,
  formatTopicTitle,
  parseContextString,
} from "../topic/context.ts";

describe("mergeTopicContext", () => {
  test("null chat project returns bound context", () => {
    const bound = { project: "p", branch: "b" };
    expect(mergeTopicContext(bound, null)).toEqual(bound);
  });

  test("null bound context uses chat project", () => {
    expect(mergeTopicContext(null, "default")).toEqual({
      project: "default",
      branch: null,
    });
  });

  test("bound without project inherits chat project", () => {
    expect(mergeTopicContext({ project: null, branch: "dev" }, "main")).toEqual({
      project: "main",
      branch: "dev",
    });
  });

  test("complete bound context takes priority", () => {
    expect(
      mergeTopicContext({ project: "p1", branch: "b1" }, "p2")
    ).toEqual({ project: "p1", branch: "b1" });
  });

  test("both null returns null", () => {
    expect(mergeTopicContext(null, null)).toBeNull();
  });
});

describe("formatContext", () => {
  test("null context", () => {
    expect(formatContext(null)).toBe("(no context)");
  });

  test("project only", () => {
    expect(formatContext({ project: "myapp", branch: null })).toBe("myapp");
  });

  test("project and branch", () => {
    expect(formatContext({ project: "myapp", branch: "dev" })).toBe("myapp @dev");
  });

  test("branch only", () => {
    expect(formatContext({ project: null, branch: "dev" })).toBe("@dev");
  });
});

describe("formatTopicTitle", () => {
  test("project only", () => {
    expect(formatTopicTitle({ project: "myapp", branch: null })).toBe("myapp");
  });

  test("project and branch", () => {
    expect(formatTopicTitle({ project: "myapp", branch: "dev" })).toBe("myapp @dev");
  });

  test("null project with branch", () => {
    expect(formatTopicTitle({ project: null, branch: "dev" })).toBe("default @dev");
  });
});

describe("parseContextString", () => {
  test("project only", () => {
    expect(parseContextString("myapp")).toEqual({ project: "myapp", branch: null });
  });

  test("project and branch", () => {
    expect(parseContextString("myapp @dev")).toEqual({ project: "myapp", branch: "dev" });
  });

  test("branch only", () => {
    expect(parseContextString("@dev")).toEqual({ project: null, branch: "dev" });
  });

  test("with extra spaces", () => {
    expect(parseContextString("  myapp  @dev  ")).toEqual({ project: "myapp", branch: "dev" });
  });
});