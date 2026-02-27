// src/__tests__/session-store.test.ts
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { SessionStore } from "../session/store.ts";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("SessionStore", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "yee88-test-"));
    storePath = join(tmpDir, "sessions.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns null for unknown session", () => {
    const store = new SessionStore(storePath);
    const result = store.getSessionResume("chat1", null, "opencode");
    expect(result).toBeNull();
  });

  test("set and get session resume", () => {
    const store = new SessionStore(storePath);
    store.setSessionResume("chat1", null, {
      engine: "opencode",
      value: "ses_abc123",
    });
    const result = store.getSessionResume("chat1", null, "opencode");
    expect(result).toEqual({ engine: "opencode", value: "ses_abc123" });
  });

  test("persists across instances", () => {
    const store1 = new SessionStore(storePath);
    store1.setSessionResume("chat1", null, {
      engine: "opencode",
      value: "ses_abc123",
    });

    const store2 = new SessionStore(storePath);
    const result = store2.getSessionResume("chat1", null, "opencode");
    expect(result).toEqual({ engine: "opencode", value: "ses_abc123" });
  });

  test("different owners have separate sessions", () => {
    const store = new SessionStore(storePath);
    store.setSessionResume("chat1", "user1", {
      engine: "opencode",
      value: "ses_user1",
    });
    store.setSessionResume("chat1", "user2", {
      engine: "opencode",
      value: "ses_user2",
    });

    expect(store.getSessionResume("chat1", "user1", "opencode")?.value).toBe("ses_user1");
    expect(store.getSessionResume("chat1", "user2", "opencode")?.value).toBe("ses_user2");
  });

  test("clear sessions removes all for chat", () => {
    const store = new SessionStore(storePath);
    store.setSessionResume("chat1", null, {
      engine: "opencode",
      value: "ses_abc",
    });
    store.clearSessions("chat1", null);
    expect(store.getSessionResume("chat1", null, "opencode")).toBeNull();
  });

  test("syncStartupCwd clears sessions on cwd change", () => {
    const store = new SessionStore(storePath);
    store.setSessionResume("chat1", null, {
      engine: "opencode",
      value: "ses_abc",
    });
    store.syncStartupCwd("/old/path");

    // Change cwd - should clear
    const cleared = store.syncStartupCwd("/new/path");
    expect(cleared).toBe(true);
    expect(store.getSessionResume("chat1", null, "opencode")).toBeNull();
  });

  test("syncStartupCwd does not clear on same cwd", () => {
    const store = new SessionStore(storePath);
    store.syncStartupCwd("/same/path");
    store.setSessionResume("chat1", null, {
      engine: "opencode",
      value: "ses_abc",
    });

    const cleared = store.syncStartupCwd("/same/path");
    expect(cleared).toBe(false);
    expect(store.getSessionResume("chat1", null, "opencode")?.value).toBe("ses_abc");
  });
});