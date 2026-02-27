// src/markdown/index.ts - Markdown 渲染和消息格式化

const STATUS = {
  running: "▸",
  update: "↻",
  done: "✓",
  fail: "✗",
} as const;

const HEADER_SEP = " · ";
const MAX_BODY_CHARS = 3500;
const MAX_PROGRESS_CMD_LEN = 300;

export interface MarkdownParts {
  header: string;
  body?: string;
  footer?: string;
}

export function assembleMarkdownParts(parts: MarkdownParts): string {
  return [parts.header, parts.body, parts.footer].filter(Boolean).join("\n\n");
}

export function formatElapsed(elapsedS: number): string {
  const total = Math.max(0, Math.floor(elapsedS));
  const seconds = total % 60;
  const totalMinutes = Math.floor(total / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatHeader(
  elapsedS: number,
  step: number | null,
  options: { label: string; engine: string }
): string {
  const elapsed = formatElapsed(elapsedS);
  const parts = [options.label, options.engine, elapsed];
  if (step != null) parts.push(`step ${step}`);
  return parts.join(HEADER_SEP);
}

export function shorten(text: string, width?: number): string {
  if (width == null) return text;
  if (width <= 0) return "";
  if (text.length <= width) return text;
  return text.slice(0, width - 1) + "…";
}

export function actionStatus(
  completed: boolean,
  ok?: boolean,
  exitCode?: number
): string {
  if (!completed) return STATUS.running;
  if (ok != null) return ok ? STATUS.done : STATUS.fail;
  if (typeof exitCode === "number" && exitCode !== 0) return STATUS.fail;
  return STATUS.done;
}

export function actionSuffix(exitCode?: number): string {
  if (typeof exitCode === "number" && exitCode !== 0) {
    return ` (exit ${exitCode})`;
  }
  return "";
}

/** 分割 Markdown 正文，保持代码块完整性 */
export function splitMarkdownBody(body: string, maxChars: number): string[] {
  if (!body?.trim()) return [];
  maxChars = Math.max(1, Math.floor(maxChars));

  // Split by double newlines (paragraph boundaries)
  const segments = body.split(/(\n{2,})/);
  const blocks: string[] = [];
  for (let i = 0; i < segments.length; i += 2) {
    const paragraph = segments[i] ?? "";
    const separator = segments[i + 1] ?? "";
    const block = paragraph + separator;
    if (block) blocks.push(block);
  }

  interface FenceState {
    fence: string;
    indent: string;
    header: string;
  }

  const FENCE_RE = /^(?<indent>[ \t]*)(?<fence>[`~]{3,})(?<info>.*)$/;

  function updateFenceState(
    line: string,
    state: FenceState | null
  ): FenceState | null {
    const match = FENCE_RE.exec(line);
    if (!match?.groups) return state;
    const fence = match.groups["fence"]!;
    const indent = match.groups["indent"]!;
    if (state == null) {
      return { fence, indent, header: line };
    }
    if (fence[0] === state.fence[0] && fence.length >= state.fence.length) {
      return null;
    }
    return state;
  }

  function scanFenceState(text: string, state: FenceState | null): FenceState | null {
    for (const line of text.split("\n")) {
      state = updateFenceState(line, state);
    }
    return state;
  }

  function closeFenceChunk(text: string, state: FenceState): string {
    const t = text.endsWith("\n") ? text : text + "\n";
    return t + `${state.indent}${state.fence}\n`;
  }

  function reopenFencePrefix(state: FenceState): string {
    return `${state.header}\n`;
  }

  function splitBlock(block: string, max: number): string[] {
    if (block.length <= max) return [block];
    const pieces: string[] = [];
    let current = "";
    for (const line of block.split(/(?<=\n)/)) {
      if (!line) continue;
      if (current && current.length + line.length > max) {
        pieces.push(current);
        current = "";
      }
      current += line;
      if (current.length >= max) {
        pieces.push(current);
        current = "";
      }
    }
    if (current) pieces.push(current);
    return pieces;
  }

  const chunks: string[] = [];
  let current = "";
  let fenceState: FenceState | null = null;

  for (const block of blocks) {
    for (const piece of splitBlock(block, maxChars)) {
      if (!current) {
        current = piece;
        fenceState = scanFenceState(piece, fenceState);
        continue;
      }
      if (current.length + piece.length <= maxChars) {
        current += piece;
        fenceState = scanFenceState(piece, fenceState);
        continue;
      }
      if (fenceState) {
        current = closeFenceChunk(current, fenceState);
      }
      chunks.push(current);
      current = fenceState ? reopenFencePrefix(fenceState) + piece : piece;
      fenceState = scanFenceState(piece, fenceState);
    }
  }

  if (current) chunks.push(current);
  return chunks.filter((c) => c.trim());
}

/** 截断正文 */
export function trimBody(body: string | undefined, maxChars = MAX_BODY_CHARS): string | undefined {
  if (!body) return undefined;
  if (body.length > maxChars) {
    return body.slice(0, maxChars - 1) + "…";
  }
  return body.trim() ? body : undefined;
}

/** 准备多段消息 */
export function prepareMultiMessage(
  parts: MarkdownParts,
  maxBodyChars = MAX_BODY_CHARS
): string[] {
  let body = parts.body;
  if (body != null && !body.trim()) body = undefined;
  const bodyChunks = body ? splitMarkdownBody(body, maxBodyChars) : [];
  if (bodyChunks.length === 0) bodyChunks.push("");

  const total = bodyChunks.length;
  return bodyChunks.map((chunk, idx) => {
    let header = parts.header;
    if (idx > 0) {
      header = header
        ? `${header} · continued (${idx + 1}/${total})`
        : `continued (${idx + 1}/${total})`;
    }
    return assembleMarkdownParts({ header, body: chunk, footer: parts.footer });
  });
}