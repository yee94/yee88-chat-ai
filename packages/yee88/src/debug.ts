// src/debug.ts - 调试日志工具
import { consola } from "consola";

let debugEnabled = false;

/** 初始化调试模式 */
export function initDebug(enabled: boolean): void {
  debugEnabled = enabled;
  if (enabled) {
    consola.info("[debug] debug mode enabled");
  }
}

/** 检查调试模式是否启用 */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/** 调试日志 - 仅在调试模式下输出 */
export function debugLog(prefix: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  consola.info(`[${prefix}]`, ...args);
}

/** 调试错误日志 - 仅在调试模式下输出详细错误信息 */
export function debugError(prefix: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  consola.error(`[${prefix}]`, ...args);
}

/** 调试 JSON 日志 - 格式化输出 JSON 对象 */
export function debugJson(prefix: string, label: string, data: unknown): void {
  if (!debugEnabled) return;
  try {
    const json = JSON.stringify(data, null, 2);
    consola.info(`[${prefix}] ${label}:`, json);
  } catch {
    consola.info(`[${prefix}] ${label}:`, String(data));
  }
}

/** 调试事件日志 - 记录事件流 */
export function debugEvent(prefix: string, event: { type: string; engine?: string; phase?: string; ok?: boolean; action?: { kind?: string; title?: string }; accumulated?: string; answer?: string; text?: string; model?: string; resume?: { value?: string } }): void {
  if (!debugEnabled) return;
  const summary = summarizeEvent(event);
  consola.info(`[${prefix}] event: ${summary}`);
}

function summarizeEvent(event: { type: string; engine?: string; phase?: string; ok?: boolean; action?: { kind?: string; title?: string }; accumulated?: string; answer?: string; text?: string; model?: string; resume?: { value?: string } }): string {
  switch (event.type) {
    case "started":
      return `started (engine=${event.engine as string})`;
    case "action": {
      const action = event.action as { kind?: string; title?: string; id?: string } | undefined;
      return `action (phase=${event.phase as string}, kind=${action?.kind ?? "?"}, title=${action?.title ?? "?"})`;
    }
    case "text":
      return `text (len=${(event.accumulated as string ?? "").length})`;
    case "text_finished":
      return `text_finished (len=${(event.text as string ?? "").length})`;
    case "completed":
      return `completed (ok=${event.ok as boolean}, answer_len=${(event.answer as string ?? "").length})`;
    default:
      return event.type;
  }
}