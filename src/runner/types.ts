// src/runner/types.ts - Runner 相关类型定义
import type { Yee88Event, ResumeToken } from "../model.ts";

/** Runner 运行选项 */
export interface RunOptions {
  model?: string;
  system?: string;
}

/** Runner 接口 */
export interface Runner {
  readonly engine: string;
  readonly model: string | undefined;

  /** 运行 prompt，返回事件异步迭代器 */
  run(prompt: string, resume: ResumeToken | null): AsyncIterable<Yee88Event>;

  /** 检查文本是否为 resume 行 */
  isResumeLine(line: string): boolean;

  /** 格式化 resume token 为可读字符串 */
  formatResume(token: ResumeToken): string;

  /** 从文本中提取 resume token */
  extractResume(text: string | null): ResumeToken | null;
}