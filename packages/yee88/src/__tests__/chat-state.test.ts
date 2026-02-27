// src/__tests__/chat-state.test.ts
import { test, expect, describe, beforeEach } from "bun:test";
import { MemoryStateAdapter } from "../chat/state.ts";

describe("MemoryStateAdapter", () => {
  let state: MemoryStateAdapter;

  beforeEach(() => {
    state = new MemoryStateAdapter();
  });

  test("get returns null for missing key", async () => {
    expect(await state.get("missing")).toBeNull();
  });

  test("set and get", async () => {
    await state.set("key1", { foo: "bar" });
    expect(await state.get<{ foo: string }>("key1")).toEqual({ foo: "bar" });
  });

  test("delete removes key", async () => {
    await state.set("key1", "value");
    await state.delete("key1");
    expect(await state.get("key1")).toBeNull();
  });

  test("TTL expiration", async () => {
    await state.set("key1", "value", 50); // 50ms TTL
    expect(await state.get<string>("key1")).toBe("value");
    await Bun.sleep(60);
    expect(await state.get("key1")).toBeNull();
  });

  test("subscribe and isSubscribed", async () => {
    expect(await state.isSubscribed("thread1")).toBe(false);
    await state.subscribe("thread1");
    expect(await state.isSubscribed("thread1")).toBe(true);
  });

  test("unsubscribe", async () => {
    await state.subscribe("thread1");
    await state.unsubscribe("thread1");
    expect(await state.isSubscribed("thread1")).toBe(false);
  });

  test("acquireLock and releaseLock", async () => {
    const lock = await state.acquireLock("thread1", 5000);
    expect(lock).not.toBeNull();
    expect(lock!.threadId).toBe("thread1");

    // Second acquire should fail
    const lock2 = await state.acquireLock("thread1", 5000);
    expect(lock2).toBeNull();

    // Release and re-acquire
    await state.releaseLock(lock!);
    const lock3 = await state.acquireLock("thread1", 5000);
    expect(lock3).not.toBeNull();
  });

  test("extendLock", async () => {
    const lock = await state.acquireLock("thread1", 5000);
    expect(lock).not.toBeNull();

    const extended = await state.extendLock(lock!, 10000);
    expect(extended).toBe(true);

    // Wrong token should fail
    const fakeLock = { threadId: "thread1", token: "fake", expiresAt: 0 };
    const failed = await state.extendLock(fakeLock, 10000);
    expect(failed).toBe(false);
  });

  test("disconnect clears everything", async () => {
    await state.set("key1", "value");
    await state.subscribe("thread1");
    await state.disconnect();
    expect(await state.get("key1")).toBeNull();
    expect(await state.isSubscribed("thread1")).toBe(false);
  });
});