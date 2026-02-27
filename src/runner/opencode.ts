// src/runner/opencode.ts - OpenCode CLI Runner
import { consola } from "consola";
import type { Yee88Event, ResumeToken, Action, ActionKind } from "../model.ts";
import { createStartedEvent, createActionEvent, createCompletedEvent } from "../model.ts";
import { decodeEvent, type OpenCodeEvent } from "../schema/opencode.ts";
import type { Runner, RunOptions } from "./types.ts";

const ENGINE = "opencode";
const RESUME_RE = /(?:^|\n)\s*`?opencode(?:\s+run)?\s+(?:--session|-s)\s+(?<token>ses_[A-Za-z0-9]+)`?\s*$/im;

/** OpenCode 流状态，跟踪 JSONL 流解析过程中的状态 */
interface StreamState {
  pendingActions: Map<string, Action>;
  lastText: string | null;
  noteSeq: number;
  sessionId: string | null;
  emittedStarted: boolean;
  sawStepFinish: boolean;
}

function createStreamState(): StreamState {
  return {
    pendingActions: new Map(),
    lastText: null,
    noteSeq: 0,
    sessionId: null,
    emittedStarted: false,
    sawStepFinish: false,
  };
}

/** 从工具名称和输入推断工具类型和标题 */
function toolKindAndTitle(
  toolName: string,
  toolInput: Record<string, unknown>
): [ActionKind, string] {
  const pathKeys = ["file_path", "filePath", "path"];
  for (const key of pathKeys) {
    const val = toolInput[key];
    if (typeof val === "string" && val) {
      if (toolName.includes("write") || toolName.includes("edit") || toolName.includes("create")) {
        return ["file_change", `\`${val}\``];
      }
      return ["tool", `\`${val}\``];
    }
  }

  const command = toolInput["command"];
  if (typeof command === "string" && command) {
    const short = command.length > 60 ? command.slice(0, 57) + "..." : command;
    return ["command", `\`${short}\``];
  }

  if (toolName.includes("search") || toolName.includes("web")) {
    return ["web_search", toolName];
  }

  if (toolName.includes("task") || toolName.includes("agent")) {
    return ["subagent", toolName];
  }

  return ["tool", toolName];
}

/** 从 tool_use part 提取 Action */
function extractToolAction(part: Record<string, unknown>): Action | null {
  const state = (part["state"] as Record<string, unknown>) ?? {};

  let callId = part["callID"] as string | undefined;
  if (!callId) callId = part["id"] as string | undefined;
  if (!callId) return null;

  const toolName = (part["tool"] as string) ?? "tool";
  let toolInput = (state["input"] as Record<string, unknown>) ?? {};
  if (typeof toolInput !== "object" || toolInput === null) toolInput = {};

  let [kind, title] = toolKindAndTitle(toolName, toolInput);

  const stateTitle = state["title"];
  if (typeof stateTitle === "string" && stateTitle) {
    title = stateTitle;
  }

  const detail: Record<string, unknown> = {
    name: toolName,
    input: toolInput,
    callID: callId,
  };

  if (kind === "file_change") {
    const path = (toolInput["file_path"] ?? toolInput["filePath"]) as string | undefined;
    if (path) {
      detail["changes"] = [{ path, kind: "update" }];
    }
  }

  return { id: callId, kind, title, detail };
}

/** 将 OpenCode 事件翻译为 Yee88 事件 */
export function translateEvent(
  event: OpenCodeEvent,
  title: string,
  state: StreamState
): Yee88Event[] {
  const sessionId = event.sessionID;
  if (typeof sessionId === "string" && sessionId && !state.sessionId) {
    state.sessionId = sessionId;
  }

  switch (event.type) {
    case "step_start": {
      if (!state.emittedStarted && state.sessionId) {
        state.emittedStarted = true;
        return [
          createStartedEvent({
            engine: ENGINE,
            resume: { engine: ENGINE, value: state.sessionId },
            title,
          }),
        ];
      }
      return [];
    }

    case "tool_use": {
      const part = (event.part ?? {}) as Record<string, unknown>;
      const toolState = (part["state"] as Record<string, unknown>) ?? {};
      const status = toolState["status"] as string | undefined;

      const action = extractToolAction(part);
      if (!action) return [];

      if (status === "completed") {
        const output = toolState["output"];
        const metadata = (toolState["metadata"] as Record<string, unknown>) ?? {};
        const exitCode = metadata["exit"] as number | undefined;
        const isError = typeof exitCode === "number" && exitCode !== 0;

        const detail: Record<string, unknown> = { ...action.detail };
        if (output != null) {
          const outputStr = String(output);
          detail["output_preview"] = outputStr.length > 500 ? outputStr.slice(0, 500) : outputStr;
        }
        detail["exit_code"] = exitCode ?? null;

        state.pendingActions.delete(action.id);

        return [
          createActionEvent({
            engine: ENGINE,
            action: { ...action, detail },
            phase: "completed",
            ok: !isError,
          }),
        ];
      }

      if (status === "error") {
        const error = toolState["error"];
        const metadata = (toolState["metadata"] as Record<string, unknown>) ?? {};
        const exitCode = metadata["exit"] as number | undefined;

        const detail: Record<string, unknown> = { ...action.detail };
        if (error != null) detail["error"] = error;
        detail["exit_code"] = exitCode ?? null;

        state.pendingActions.delete(action.id);

        return [
          createActionEvent({
            engine: ENGINE,
            action: { ...action, detail },
            phase: "completed",
            ok: false,
            message: error != null ? String(error) : undefined,
          }),
        ];
      }

      // status is pending/running - emit started
      state.pendingActions.set(action.id, action);
      return [
        createActionEvent({
          engine: ENGINE,
          action,
          phase: "started",
        }),
      ];
    }

    case "text": {
      const part = (event.part ?? {}) as Record<string, unknown>;
      const text = part["text"];
      if (typeof text === "string" && text) {
        state.lastText = (state.lastText ?? "") + text;
      }
      return [];
    }

    case "step_finish": {
      const part = (event.part ?? {}) as Record<string, unknown>;
      const reason = part["reason"] as string | undefined;
      state.sawStepFinish = true;

      if (reason === "stop") {
        const resume: ResumeToken | undefined = state.sessionId
          ? { engine: ENGINE, value: state.sessionId }
          : undefined;

        return [
          createCompletedEvent({
            engine: ENGINE,
            ok: true,
            answer: state.lastText ?? "",
            resume,
          }),
        ];
      }
      return [];
    }

    case "error": {
      const rawMessage = event.message ?? event.error;
      let message: string;

      if (typeof rawMessage === "object" && rawMessage !== null) {
        const obj = rawMessage as Record<string, unknown>;
        const data = obj["data"] as Record<string, unknown> | undefined;
        if (data && typeof data["message"] === "string") {
          message = data["message"];
        } else {
          message =
            (typeof obj["message"] === "string" ? obj["message"] : null) ??
            (typeof obj["name"] === "string" ? obj["name"] : null) ??
            "opencode error";
        }
      } else if (rawMessage == null) {
        message = "opencode error";
      } else {
        message = String(rawMessage);
      }

      const resume: ResumeToken | undefined = state.sessionId
        ? { engine: ENGINE, value: state.sessionId }
        : undefined;

      return [
        createCompletedEvent({
          engine: ENGINE,
          ok: false,
          answer: state.lastText ?? "",
          resume,
          error: message,
        }),
      ];
    }

    default:
      return [];
  }
}

/** OpenCode CLI Runner */
export class OpenCodeRunner implements Runner {
  readonly engine = ENGINE;
  readonly model: string | undefined;
  private readonly cmd: string;
  private readonly sessionTitle: string;

  constructor(options?: { model?: string; cmd?: string; sessionTitle?: string }) {
    this.model = options?.model;
    this.cmd = options?.cmd ?? "opencode";
    this.sessionTitle = options?.sessionTitle ?? "opencode";
  }

  isResumeLine(line: string): boolean {
    return RESUME_RE.test(line);
  }

  formatResume(token: ResumeToken): string {
    if (token.engine !== ENGINE) {
      throw new Error(`resume token is for engine ${token.engine}`);
    }
    return `\`opencode --session ${token.value}\``;
  }

  extractResume(text: string | null): ResumeToken | null {
    if (!text) return null;
    let found: string | null = null;
    // 使用更简单的正则表达式来匹配 resume token，不需要行锚点
    const re = /`?opencode(?:\s+run)?\s+(?:--session|-s)\s+(?<token>ses_[A-Za-z0-9]+)`?/g;
    for (const match of text.matchAll(re)) {
      const token = match.groups?.["token"];
      if (token) found = token;
    }
    if (!found) return null;
    return { engine: ENGINE, value: found };
  }

  private buildArgs(prompt: string, resume: ResumeToken | null, runOptions?: RunOptions): string[] {
    const args = ["run", "--format", "json"];
    if (resume) {
      args.push("--session", resume.value);
    }
    const model = runOptions?.model ?? this.model;
    if (model) {
      args.push("--model", model);
    }
    if (!resume && runOptions?.system) {
      prompt = `${runOptions.system}\n\n---\n\n${prompt}`;
    }
    args.push("--", prompt);
    return args;
  }

  async *run(
    prompt: string,
    resume: ResumeToken | null,
    runOptions?: RunOptions
  ): AsyncGenerator<Yee88Event> {
    const args = this.buildArgs(prompt, resume, runOptions);
    const state = createStreamState();

    consola.info(`[opencode] spawning: ${this.cmd} ${args.slice(0, 3).join(" ")} ...`);

    const cwd = runOptions?.cwd;
    if (cwd) {
      consola.info(`[opencode] cwd: ${cwd}`);
    }

    const proc = Bun.spawn([this.cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      ...(cwd ? { cwd } : {}),
    });

    // Drain stderr in background
    const stderrChunks: string[] = [];
    const drainStderr = async () => {
      if (!proc.stderr) return;
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stderrChunks.push(decoder.decode(value, { stream: true }));
        }
      } catch {
        // stderr closed
      }
    };
    const stderrPromise = drainStderr();

    // Process stdout JSONL stream
    if (!proc.stdout) {
      throw new Error("opencode failed to open subprocess pipes");
    }

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let didEmitCompleted = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = decodeEvent(trimmed);
            const events = translateEvent(event, this.sessionTitle, state);
            for (const evt of events) {
              yield evt;
              if (evt.type === "completed") {
                didEmitCompleted = true;
              }
            }
          } catch (err) {
            consola.warn(`[opencode] invalid JSONL line: ${trimmed.slice(0, 100)}`);
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const event = decodeEvent(buffer.trim());
          const events = translateEvent(event, this.sessionTitle, state);
          for (const evt of events) {
            yield evt;
            if (evt.type === "completed") didEmitCompleted = true;
          }
        } catch {
          // ignore trailing partial line
        }
      }
    } finally {
      await stderrPromise;
    }

    const exitCode = await proc.exited;

    if (!didEmitCompleted) {
      if (exitCode !== 0) {
        const stderrText = stderrChunks.join("");
        const errorMsg = stderrText.trim() || `opencode failed (rc=${exitCode})`;
        yield createCompletedEvent({
          engine: ENGINE,
          ok: false,
          answer: state.lastText ?? "",
          resume: state.sessionId ? { engine: ENGINE, value: state.sessionId } : undefined,
          error: errorMsg,
        });
      } else {
        yield createCompletedEvent({
          engine: ENGINE,
          ok: false,
          answer: state.lastText ?? "",
          resume: state.sessionId ? { engine: ENGINE, value: state.sessionId } : undefined,
          error: "opencode finished without a result event",
        });
      }
    }
  }
}