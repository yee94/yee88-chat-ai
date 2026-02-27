// src/__tests__/session-lock.test.ts
import { test, expect, describe } from "bun:test";
import { SessionLockManager } from "../session/lock.ts";

describe("SessionLockManager", () => {
  test("withLock serializes access", async () => {
    const manager = new SessionLockManager();
    const token = { engine: "opencode", value: "ses_abc" };
    const order: number[] = [];

    const task1 = manager.withLock(token, async () => {
      order.push(1);
      await Bun.sleep(50);
      order.push(2);
    });

    const task2 = manager.withLock(token, async () => {
      order.push(3);
      await Bun.sleep(10);
      order.push(4);
    });

    await Promise.all([task1, task2]);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test("different tokens run in parallel", async () => {
    const manager = new SessionLockManager();
    const token1 = { engine: "opencode", value: "ses_1" };
    const token2 = { engine: "opencode", value: "ses_2" };
    const order: string[] = [];

    const task1 = manager.withLock(token1, async () => {
      order.push("1-start");
      await Bun.sleep(50);
      order.push("1-end");
    });

    const task2 = manager.withLock(token2, async () => {
      order.push("2-start");
      await Bun.sleep(10);
      order.push("2-end");
    });

    await Promise.all([task1, task2]);
    // Both should start before either ends
    expect(order[0]).toBe("1-start");
    expect(order[1]).toBe("2-start");
  });
});