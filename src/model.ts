// src/model.ts - 核心领域模型类型（事件、动作、恢复令牌）

export type EngineId = string;

export type ActionKind =
  | "command"
  | "tool"
  | "file_change"
  | "web_search"
  | "subagent"
  | "note"
  | "turn"
  | "warning"
  | "telemetry";

export type ActionPhase = "started" | "updated" | "completed";
export type ActionLevel = "debug" | "info" | "warning" | "error";

export interface ResumeToken {
  engine: EngineId;
  value: string;
}

export interface Action {
  id: string;
  kind: ActionKind;
  title: string;
  detail: Record<string, unknown>;
}

export interface StartedEvent {
  type: "started";
  engine: EngineId;
  resume: ResumeToken;
  title?: string;
  meta?: Record<string, unknown>;
}

export interface ActionEvent {
  type: "action";
  engine: EngineId;
  action: Action;
  phase: ActionPhase;
  ok?: boolean;
  message?: string;
  level?: ActionLevel;
}

export interface CompletedEvent {
  type: "completed";
  engine: EngineId;
  ok: boolean;
  answer: string;
  resume?: ResumeToken;
  error?: string;
  usage?: Record<string, unknown>;
}

export type Yee88Event = StartedEvent | ActionEvent | CompletedEvent;

// Helper constructors
export function createStartedEvent(params: Omit<StartedEvent, "type">): StartedEvent {
  return { type: "started", ...params };
}

export function createActionEvent(params: Omit<ActionEvent, "type">): ActionEvent {
  return { type: "action", ...params };
}

export function createCompletedEvent(params: Omit<CompletedEvent, "type">): CompletedEvent {
  return { type: "completed", ...params };
}