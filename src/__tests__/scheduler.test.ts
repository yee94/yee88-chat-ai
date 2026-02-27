// src/__tests__/scheduler.test.ts
import { test, expect, describe } from "bun:test";
import { ThreadScheduler, type ThreadJob } from "../scheduler/index.ts";

describe("ThreadScheduler", () => {
  test("threadKey generates correct key", () => {
    expect(ThreadScheduler.threadKey({ engine: "opencode", value: "ses_abc" })).toBe(
      "opencode:ses_abc"
    );
  });

  test("serializes jobs for same thread", async () => {
    const order: number[] = [];
    const scheduler = new ThreadScheduler(async (job) => {
      const num = Number(job.text);
      order.push(num);
      await Bun.sleep(10);
    });

    const token = { engine: "opencode", value: "ses_abc" };
    await Promise.all([
      scheduler.enqueue({ chatId: "c1", userMsgId: "m1", text: "1", resumeToken: token }),
      scheduler.enqueue({ chatId: "c1", userMsgId: "m2", text: "2", resumeToken: token }),
      scheduler.enqueue({ chatId: "c1", userMsgId: "m3", text: "3", resumeToken: token }),
    ]);

    // Wait for all jobs to complete
    await Bun.sleep(100);
    expect(order).toEqual([1, 2, 3]);
  });

  test("parallelizes jobs for different threads", async () => {
    const starts: string[] = [];
    const scheduler = new ThreadScheduler(async (job) => {
      starts.push(job.text);
      await Bun.sleep(50);
    });

    const token1 = { engine: "opencode", value: "ses_1" };
    const token2 = { engine: "opencode", value: "ses_2" };

    scheduler.enqueue({ chatId: "c1", userMsgId: "m1", text: "t1", resumeToken: token1 });
    scheduler.enqueue({ chatId: "c2", userMsgId: "m2", text: "t2", resumeToken: token2 });

    await Bun.sleep(20);
    // Both should have started
    expect(starts).toContain("t1");
    expect(starts).toContain("t2");
    await Bun.sleep(100); // cleanup
  });

  test("cancelQueued removes pending jobs", async () => {
    const executed: string[] = [];
    const scheduler = new ThreadScheduler(async (job) => {
      executed.push(job.text);
      await Bun.sleep(100);
    });

    const token = { engine: "opencode", value: "ses_abc" };
    scheduler.enqueue({ chatId: "c1", userMsgId: "m1", text: "first", resumeToken: token });
    scheduler.enqueue({ chatId: "c1", userMsgId: "m2", text: "second", resumeToken: token });
    scheduler.enqueue({ chatId: "c1", userMsgId: "m3", text: "third", resumeToken: token });

    await Bun.sleep(10);
    const cancelled = scheduler.cancelQueued(token);
    expect(cancelled).toBeGreaterThanOrEqual(1);

    await Bun.sleep(200);
    expect(executed).toContain("first");
    expect(executed).not.toContain("third");
  });
});