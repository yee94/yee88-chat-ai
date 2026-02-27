// src/session/lock.ts - 会话锁
import type { ResumeToken } from "../model.ts";

/** 简单的异步互斥锁 */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

/** 会话锁管理器 */
export class SessionLockManager {
  private locks = new Map<string, AsyncMutex>();

  private keyFor(token: ResumeToken): string {
    return `${token.engine}:${token.value}`;
  }

  /** 获取指定 token 的锁 */
  lockFor(token: ResumeToken): AsyncMutex {
    const key = this.keyFor(token);
    let lock = this.locks.get(key);
    if (!lock) {
      lock = new AsyncMutex();
      this.locks.set(key, lock);
    }
    return lock;
  }

  /** 带锁执行异步函数 */
  async withLock<T>(token: ResumeToken, fn: () => Promise<T>): Promise<T> {
    const lock = this.lockFor(token);
    await lock.acquire();
    try {
      return await fn();
    } finally {
      lock.release();
    }
  }
}