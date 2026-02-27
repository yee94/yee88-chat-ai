// src/topic/state.ts - Topic 状态管理
import { consola } from "consola";
import { readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from "fs";
import { dirname } from "path";

const STATE_VERSION = 1;

/** 运行上下文：项目 + 分支 */
export interface RunContext {
  project: string | null;
  branch: string | null;
}

/** 单个 Topic 线程状态 */
interface ThreadState {
  context: RunContext | null;
  sessions: Record<string, string>; // engine -> resume token value
  topicTitle: string | null;
  defaultEngine: string | null;
  triggerMode: string | null; // "mentions" | null (all)
}

/** 顶层 Topic 状态 */
interface TopicStoreState {
  version: number;
  threads: Record<string, ThreadState>; // key: "chatId:threadId"
}

/** Topic 线程快照 */
export interface TopicSnapshot {
  chatId: string;
  threadId: string;
  context: RunContext | null;
  sessions: Record<string, string>;
  topicTitle: string | null;
  defaultEngine: string | null;
}

function threadKey(chatId: string | number, threadId: string | number): string {
  return `${chatId}:${threadId}`;
}

function newState(): TopicStoreState {
  return { version: STATE_VERSION, threads: {} };
}

function newThreadState(): ThreadState {
  return {
    context: null,
    sessions: {},
    topicTitle: null,
    defaultEngine: null,
    triggerMode: null,
  };
}

export class TopicStateStore {
  private state: TopicStoreState;
  private readonly path: string;
  private lastMtime: number = 0;

  constructor(path: string) {
    this.path = path;
    this.state = newState();
    this.loadIfNeeded();
  }

  private loadIfNeeded(): void {
    try {
      const stat = statSync(this.path);
      const mtime = stat.mtimeMs;
      if (mtime <= this.lastMtime) return;
      this.lastMtime = mtime;
      const text = readFileSync(this.path, "utf-8");
      const parsed = JSON.parse(text) as TopicStoreState;
      if (parsed.version === STATE_VERSION) {
        this.state = parsed;
      } else {
        this.state = newState();
      }
    } catch {
      // File doesn't exist or invalid
    }
  }

  private save(): void {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true });
    const content = JSON.stringify(this.state, null, 2);
    const tmpPath = `${this.path}.tmp`;
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, this.path);
    try {
      this.lastMtime = statSync(this.path).mtimeMs;
    } catch {}
  }

  private ensureThread(chatId: string | number, threadId: string | number): ThreadState {
    this.loadIfNeeded();
    const key = threadKey(chatId, threadId);
    if (!this.state.threads[key]) {
      this.state.threads[key] = newThreadState();
    }
    return this.state.threads[key]!;
  }

  /** 获取 Topic 的运行上下文 */
  getContext(chatId: string | number, threadId: string | number): RunContext | null {
    this.loadIfNeeded();
    const key = threadKey(chatId, threadId);
    return this.state.threads[key]?.context ?? null;
  }

  /** 设置 Topic 的运行上下文 */
  setContext(
    chatId: string | number,
    threadId: string | number,
    context: RunContext,
    topicTitle?: string
  ): void {
    const thread = this.ensureThread(chatId, threadId);
    thread.context = context;
    if (topicTitle !== undefined) {
      thread.topicTitle = topicTitle;
    }
    this.save();
  }

  /** 清除 Topic 的运行上下文 */
  clearContext(chatId: string | number, threadId: string | number): void {
    this.loadIfNeeded();
    const key = threadKey(chatId, threadId);
    const thread = this.state.threads[key];
    if (thread) {
      thread.context = null;
      this.save();
    }
  }

  /** 获取 Topic 的 resume token */
  getSessionResume(
    chatId: string | number,
    threadId: string | number,
    engine: string
  ): string | null {
    this.loadIfNeeded();
    const key = threadKey(chatId, threadId);
    return this.state.threads[key]?.sessions[engine] ?? null;
  }

  /** 设置 Topic 的 resume token */
  setSessionResume(
    chatId: string | number,
    threadId: string | number,
    engine: string,
    resumeValue: string
  ): void {
    const thread = this.ensureThread(chatId, threadId);
    thread.sessions[engine] = resumeValue;
    this.save();
  }

  /** 清除 Topic 的所有会话 */
  clearSessions(chatId: string | number, threadId: string | number): void {
    this.loadIfNeeded();
    const key = threadKey(chatId, threadId);
    const thread = this.state.threads[key];
    if (thread) {
      thread.sessions = {};
      this.save();
    }
  }

  /** 获取 Topic 快照 */
  getSnapshot(chatId: string | number, threadId: string | number): TopicSnapshot | null {
    this.loadIfNeeded();
    const key = threadKey(chatId, threadId);
    const thread = this.state.threads[key];
    if (!thread) return null;
    return {
      chatId: String(chatId),
      threadId: String(threadId),
      context: thread.context,
      sessions: { ...thread.sessions },
      topicTitle: thread.topicTitle,
      defaultEngine: thread.defaultEngine,
    };
  }

  /** 根据 context 查找 threadId */
  findThreadForContext(
    chatId: string | number,
    context: RunContext
  ): string | null {
    this.loadIfNeeded();
    const prefix = `${chatId}:`;
    for (const [key, thread] of Object.entries(this.state.threads)) {
      if (!key.startsWith(prefix)) continue;
      if (
        thread.context &&
        thread.context.project === context.project &&
        thread.context.branch === context.branch
      ) {
        return key.slice(prefix.length);
      }
    }
    return null;
  }

  /** 删除 Topic 记录 */
  deleteThread(chatId: string | number, threadId: string | number): boolean {
    this.loadIfNeeded();
    const key = threadKey(chatId, threadId);
    if (this.state.threads[key]) {
      delete this.state.threads[key];
      this.save();
      return true;
    }
    return false;
  }

  /** 列出指定 chat 的所有 Topic */
  listThreads(chatId: string | number): TopicSnapshot[] {
    this.loadIfNeeded();
    const prefix = `${chatId}:`;
    const results: TopicSnapshot[] = [];
    for (const [key, thread] of Object.entries(this.state.threads)) {
      if (!key.startsWith(prefix)) continue;
      results.push({
        chatId: String(chatId),
        threadId: key.slice(prefix.length),
        context: thread.context,
        sessions: { ...thread.sessions },
        topicTitle: thread.topicTitle,
        defaultEngine: thread.defaultEngine,
      });
    }
    return results;
  }

  /** 设置默认引擎 */
  setDefaultEngine(
    chatId: string | number,
    threadId: string | number,
    engine: string | null
  ): void {
    const thread = this.ensureThread(chatId, threadId);
    thread.defaultEngine = engine;
    this.save();
  }

  /** 设置触发模式 */
  setTriggerMode(
    chatId: string | number,
    threadId: string | number,
    mode: string | null
  ): void {
    const thread = this.ensureThread(chatId, threadId);
    thread.triggerMode = mode;
    this.save();
  }

  /** 获取触发模式 */
  getTriggerMode(chatId: string | number, threadId: string | number): string | null {
    this.loadIfNeeded();
    const key = threadKey(chatId, threadId);
    return this.state.threads[key]?.triggerMode ?? null;
  }
}