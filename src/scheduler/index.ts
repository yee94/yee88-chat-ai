// src/scheduler/index.ts - 线程任务调度器
import { consola } from "consola";
import type { ResumeToken } from "../model.ts";

export interface ThreadJob {
  chatId: string | number;
  userMsgId: string | number;
  text: string;
  resumeToken: ResumeToken;
  threadId?: string | number;
}

type RunJobFn = (job: ThreadJob) => Promise<void>;

/** 线程调度器：确保同一线程内串行执行，不同线程间并行执行 */
export class ThreadScheduler {
  private pendingByThread = new Map<string, ThreadJob[]>();
  private activeThreads = new Set<string>();
  private readonly runJob: RunJobFn;

  constructor(runJob: RunJobFn) {
    this.runJob = runJob;
  }

  static threadKey(token: ResumeToken): string {
    return `${token.engine}:${token.value}`;
  }

  async enqueue(job: ThreadJob): Promise<void> {
    const key = ThreadScheduler.threadKey(job.resumeToken);

    let queue = this.pendingByThread.get(key);
    if (!queue) {
      queue = [];
      this.pendingByThread.set(key, queue);
    }
    queue.push(job);

    if (this.activeThreads.has(key)) {
      return; // Worker already running for this thread
    }

    this.activeThreads.add(key);
    // Fire and forget - worker runs in background
    this.threadWorker(key).catch((err) => {
      consola.error(`[scheduler] worker error for ${key}:`, err);
    });
  }

  private async threadWorker(key: string): Promise<void> {
    try {
      while (true) {
        const queue = this.pendingByThread.get(key);
        if (!queue || queue.length === 0) break;

        const job = queue.shift()!;
        try {
          await this.runJob(job);
        } catch (err) {
          consola.error(`[scheduler] job error:`, err);
        }
      }
    } finally {
      this.activeThreads.delete(key);
      this.pendingByThread.delete(key);
    }
  }

  /** 取消指定线程的所有排队任务 */
  cancelQueued(token: ResumeToken): number {
    const key = ThreadScheduler.threadKey(token);
    const queue = this.pendingByThread.get(key);
    if (!queue) return 0;
    const count = queue.length;
    queue.length = 0;
    return count;
  }

  /** 获取当前活跃线程数 */
  get activeCount(): number {
    return this.activeThreads.size;
  }

  /** 获取指定线程的排队任务数 */
  queuedCount(token: ResumeToken): number {
    const key = ThreadScheduler.threadKey(token);
    return this.pendingByThread.get(key)?.length ?? 0;
  }
}