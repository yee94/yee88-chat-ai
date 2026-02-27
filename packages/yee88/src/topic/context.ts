// src/topic/context.ts - Topic 上下文合并
import type { RunContext } from "./state.ts";

/**
 * 合并 Topic 绑定的 context 和 chat 级别的默认项目。
 * 优先级：topic context > chat default project
 */
export function mergeTopicContext(
  boundContext: RunContext | null,
  chatProject: string | null
): RunContext | null {
  if (chatProject == null) {
    return boundContext;
  }
  if (boundContext == null) {
    return { project: chatProject, branch: null };
  }
  if (boundContext.project == null) {
    return { project: chatProject, branch: boundContext.branch };
  }
  return boundContext;
}

/** 格式化 context 为可读字符串 */
export function formatContext(context: RunContext | null): string {
  if (!context) return "(no context)";
  const parts: string[] = [];
  if (context.project) parts.push(context.project);
  if (context.branch) parts.push(`@${context.branch}`);
  return parts.join(" ") || "(no context)";
}

/** 格式化 Topic 标题 */
export function formatTopicTitle(context: RunContext): string {
  if (context.branch) {
    return `${context.project ?? "default"} @${context.branch}`;
  }
  return context.project ?? "default";
}

/** 解析 "/project @branch" 格式的字符串 */
export function parseContextString(input: string): RunContext {
  const trimmed = input.trim();
  const branchMatch = trimmed.match(/@(\S+)/);
  const branch = branchMatch ? branchMatch[1]! : null;
  const project = trimmed.replace(/@\S+/, "").trim() || null;
  return { project, branch };
}