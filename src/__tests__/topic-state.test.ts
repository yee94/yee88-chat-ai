// src/__tests__/topic-state.test.ts
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { TopicStateStore, type RunContext } from "../topic/state.ts";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("TopicStateStore", () => {
  let tmpDir: string;
  let storePath: string;
  let store: TopicStateStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "yee88-topic-test-"));
    storePath = join(tmpDir, "topics.json");
    store = new TopicStateStore(storePath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("getContext returns null for unknown topic", () => {
    expect(store.getContext("chat1", "topic1")).toBeNull();
  });

  test("setContext and getContext", () => {
    const ctx: RunContext = { project: "myproject", branch: "main" };
    store.setContext("chat1", "topic1", ctx, "myproject @main");
    expect(store.getContext("chat1", "topic1")).toEqual(ctx);
  });

  test("clearContext", () => {
    store.setContext("chat1", "topic1", { project: "p", branch: null });
    store.clearContext("chat1", "topic1");
    expect(store.getContext("chat1", "topic1")).toBeNull();
  });

  test("session resume per topic", () => {
    store.setSessionResume("chat1", "topic1", "opencode", "ses_abc");
    store.setSessionResume("chat1", "topic2", "opencode", "ses_def");
    expect(store.getSessionResume("chat1", "topic1", "opencode")).toBe("ses_abc");
    expect(store.getSessionResume("chat1", "topic2", "opencode")).toBe("ses_def");
  });

  test("clearSessions", () => {
    store.setSessionResume("chat1", "topic1", "opencode", "ses_abc");
    store.clearSessions("chat1", "topic1");
    expect(store.getSessionResume("chat1", "topic1", "opencode")).toBeNull();
  });

  test("getSnapshot", () => {
    store.setContext("chat1", "topic1", { project: "p", branch: "b" }, "p @b");
    store.setSessionResume("chat1", "topic1", "opencode", "ses_abc");
    const snap = store.getSnapshot("chat1", "topic1");
    expect(snap).not.toBeNull();
    expect(snap!.context).toEqual({ project: "p", branch: "b" });
    expect(snap!.sessions["opencode"]).toBe("ses_abc");
    expect(snap!.topicTitle).toBe("p @b");
  });

  test("findThreadForContext", () => {
    store.setContext("chat1", "topic1", { project: "p1", branch: "main" });
    store.setContext("chat1", "topic2", { project: "p2", branch: null });
    expect(store.findThreadForContext("chat1", { project: "p1", branch: "main" })).toBe("topic1");
    expect(store.findThreadForContext("chat1", { project: "p2", branch: null })).toBe("topic2");
    expect(store.findThreadForContext("chat1", { project: "p3", branch: null })).toBeNull();
  });

  test("deleteThread", () => {
    store.setContext("chat1", "topic1", { project: "p", branch: null });
    expect(store.deleteThread("chat1", "topic1")).toBe(true);
    expect(store.getContext("chat1", "topic1")).toBeNull();
    expect(store.deleteThread("chat1", "topic1")).toBe(false);
  });

  test("listThreads", () => {
    store.setContext("chat1", "topic1", { project: "p1", branch: null }, "p1");
    store.setContext("chat1", "topic2", { project: "p2", branch: "dev" }, "p2 @dev");
    store.setContext("chat2", "topic3", { project: "p3", branch: null }); // different chat
    const list = store.listThreads("chat1");
    expect(list).toHaveLength(2);
    expect(list.map(t => t.topicTitle).sort()).toEqual(["p1", "p2 @dev"]);
  });

  test("persists across instances", () => {
    store.setContext("chat1", "topic1", { project: "p", branch: "b" });
    const store2 = new TopicStateStore(storePath);
    expect(store2.getContext("chat1", "topic1")).toEqual({ project: "p", branch: "b" });
  });

  test("setDefaultEngine and setTriggerMode", () => {
    store.setDefaultEngine("chat1", "topic1", "opencode");
    store.setTriggerMode("chat1", "topic1", "mentions");
    const snap = store.getSnapshot("chat1", "topic1");
    expect(snap!.defaultEngine).toBe("opencode");
    expect(store.getTriggerMode("chat1", "topic1")).toBe("mentions");
  });
});