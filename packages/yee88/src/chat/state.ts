// src/chat/state.ts - 内存版 StateAdapter 实现
import type { StateAdapter, Lock } from "chat";
import { randomUUID } from "crypto";

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt?: number;
}

export class MemoryStateAdapter implements StateAdapter {
  private store = new Map<string, CacheEntry>();
  private subscriptions = new Set<string>();
  private locks = new Map<string, Lock>();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.store.clear();
    this.subscriptions.clear();
    this.locks.clear();
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    const entry: CacheEntry<T> = { value };
    if (ttlMs) {
      entry.expiresAt = Date.now() + ttlMs;
    }
    this.store.set(key, entry as CacheEntry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    return this.subscriptions.has(threadId);
  }

  async subscribe(threadId: string): Promise<void> {
    this.subscriptions.add(threadId);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.subscriptions.delete(threadId);
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const existing = this.locks.get(threadId);
    if (existing && Date.now() < existing.expiresAt) {
      return null; // Already locked
    }
    const lock: Lock = {
      threadId,
      token: randomUUID(),
      expiresAt: Date.now() + ttlMs,
    };
    this.locks.set(threadId, lock);
    return lock;
  }

  async releaseLock(lock: Lock): Promise<void> {
    const existing = this.locks.get(lock.threadId);
    if (existing?.token === lock.token) {
      this.locks.delete(lock.threadId);
    }
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const existing = this.locks.get(lock.threadId);
    if (!existing || existing.token !== lock.token) return false;
    existing.expiresAt = Date.now() + ttlMs;
    return true;
  }
}