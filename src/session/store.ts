// src/session/store.ts - 会话状态持久化存储
import { consola } from "consola";
import type { ResumeToken } from "../model.ts";

const STATE_VERSION = 1;

interface SessionState {
  resume: string;
}

interface ChatState {
  sessions: Record<string, SessionState>;
}

interface SessionsState {
  version: number;
  cwd: string | null;
  chats: Record<string, ChatState>;
}

function chatKey(chatId: string | number, ownerId: string | number | null): string {
  const owner = ownerId == null ? "chat" : String(ownerId);
  return `${chatId}:${owner}`;
}

function newState(): SessionsState {
  return { version: STATE_VERSION, cwd: null, chats: {} };
}

export class SessionStore {
  private state: SessionsState;
  private readonly path: string;
  private lastMtime: number = 0;

  constructor(path: string) {
    this.path = path;
    this.state = newState();
    this.loadIfNeeded();
  }

  private loadIfNeeded(): void {
    try {
      const file = Bun.file(this.path);
      // Check if file exists by trying to get size synchronously
      // We'll use a sync approach for simplicity
      const text = require("fs").readFileSync(this.path, "utf-8");
      const stat = require("fs").statSync(this.path);
      const mtime = stat.mtimeMs;
      if (mtime <= this.lastMtime) return;
      this.lastMtime = mtime;

      const parsed = JSON.parse(text) as SessionsState;
      if (parsed.version === STATE_VERSION) {
        this.state = parsed;
      } else {
        consola.warn(`[session-store] version mismatch, resetting state`);
        this.state = newState();
      }
    } catch {
      // File doesn't exist or is invalid
    }
  }

  private save(): void {
    const dir = this.path.substring(0, this.path.lastIndexOf("/"));
    require("fs").mkdirSync(dir, { recursive: true });
    const content = JSON.stringify(this.state, null, 2);
    // Atomic write: write to temp then rename
    const tmpPath = `${this.path}.tmp`;
    require("fs").writeFileSync(tmpPath, content, "utf-8");
    require("fs").renameSync(tmpPath, this.path);
    this.lastMtime = require("fs").statSync(this.path).mtimeMs;
  }

  getSessionResume(
    chatId: string | number,
    ownerId: string | number | null,
    engine: string
  ): ResumeToken | null {
    this.loadIfNeeded();
    const key = chatKey(chatId, ownerId);
    const chat = this.state.chats[key];
    if (!chat) return null;
    const entry = chat.sessions[engine];
    if (!entry?.resume) return null;
    return { engine, value: entry.resume };
  }

  setSessionResume(
    chatId: string | number,
    ownerId: string | number | null,
    token: ResumeToken
  ): void {
    this.loadIfNeeded();
    const key = chatKey(chatId, ownerId);
    if (!this.state.chats[key]) {
      this.state.chats[key] = { sessions: {} };
    }
    this.state.chats[key]!.sessions[token.engine] = { resume: token.value };
    if (!this.state.cwd) {
      this.state.cwd = process.cwd();
    }
    this.save();
  }

  clearSessions(chatId: string | number, ownerId: string | number | null): void {
    this.loadIfNeeded();
    const key = chatKey(chatId, ownerId);
    const chat = this.state.chats[key];
    if (!chat) return;
    chat.sessions = {};
    this.save();
  }

  /** 同步启动 CWD，如果变更则清空所有会话 */
  syncStartupCwd(cwd: string): boolean {
    this.loadIfNeeded();
    const previous = this.state.cwd;
    let cleared = false;
    if (previous != null && previous !== cwd) {
      this.state.chats = {};
      cleared = true;
    }
    if (previous !== cwd) {
      this.state.cwd = cwd;
      this.save();
    }
    return cleared;
  }
}