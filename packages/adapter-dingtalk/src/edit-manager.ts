/**
 * EditManager - Debounced batch edit for DingTalk messages.
 *
 * Since DingTalk doesn't support native message editing, this manager
 * implements a "send new + recall old" strategy with debouncing to
 * minimize message flicker and residual messages.
 *
 * Key design decisions:
 * - Debounce multiple rapid edits into a single operation
 * - "Send first, recall later" to ensure user always sees latest content
 * - Best-effort recall (failures don't block the flow)
 * - Per-thread state isolation for concurrent conversations
 */

import type { Logger } from "chat";

/** Result of an edit operation. */
export interface EditResult {
  /** New message ID after edit. */
  messageId: string;
  /** processQueryKey for the new message (if available). */
  processQueryKey?: string;
}

/** Callback to send a new message. Returns messageId and optional processQueryKey. */
export type SendFn = (content: string, threadId: string) => Promise<EditResult>;

/** Callback to recall a message by processQueryKey. */
export type RecallFn = (processQueryKey: string, threadId: string) => Promise<void>;

interface PendingResolver {
  resolve: (result: EditResult) => void;
  reject: (error: Error) => void;
}

interface EditState {
  /** Current live message's processQueryKey (for recall). */
  currentProcessQueryKey: string | undefined;

  /** Pending edit content (latest wins). */
  pendingContent: string | null;

  /** Resolvers waiting for the pending edit. */
  pendingResolvers: PendingResolver[];

  /** Timestamp of the first pending edit (for max-wait enforcement). */
  firstPendingTime: number | null;

  /** Debounce timer. */
  debounceTimer: ReturnType<typeof setTimeout> | null;

  /** Whether an edit operation is currently executing. */
  isExecuting: boolean;
}

export interface EditManagerOptions {
  /** Debounce delay in ms (default: 300). */
  debounceMs?: number;
  /** Maximum wait time before forcing a flush (default: 2000). */
  maxWaitMs?: number;
}

/**
 * Manages debounced message editing via "send new + recall old".
 *
 * Usage:
 * ```typescript
 * const manager = new EditManager(sendFn, recallFn, logger);
 *
 * // Register initial message
 * manager.trackMessage(threadId, processQueryKey);
 *
 * // Queue edits (debounced)
 * await manager.queueEdit(threadId, "Processing 30%...");
 * await manager.queueEdit(threadId, "Processing 60%...");
 * await manager.queueEdit(threadId, "Done!"); // Only this one executes
 * ```
 */
export class EditManager {
  private readonly states = new Map<string, EditState>();
  private readonly sendFn: SendFn;
  private readonly recallFn: RecallFn;
  private readonly logger?: Logger;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;

  constructor(
    sendFn: SendFn,
    recallFn: RecallFn,
    logger?: Logger,
    options?: EditManagerOptions,
  ) {
    this.sendFn = sendFn;
    this.recallFn = recallFn;
    this.logger = logger;
    this.debounceMs = options?.debounceMs ?? 300;
    this.maxWaitMs = options?.maxWaitMs ?? 2000;
  }

  /**
   * Register an initial message for tracking.
   * Call this after the first postMessage to enable recall on subsequent edits.
   */
  trackMessage(threadId: string, processQueryKey?: string): void {
    const state = this.getOrCreateState(threadId);
    state.currentProcessQueryKey = processQueryKey;
  }

  /**
   * Queue an edit operation. Multiple rapid calls are debounced.
   * Returns when the edit is actually executed (or skipped if superseded).
   */
  async queueEdit(threadId: string, content: string): Promise<EditResult> {
    return new Promise<EditResult>((resolve, reject) => {
      const state = this.getOrCreateState(threadId);

      // Update pending content (latest wins)
      state.pendingContent = content;
      state.pendingResolvers.push({ resolve, reject });

      // Reset debounce timer
      if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
      }

      const now = Date.now();

      // Check if max wait time exceeded
      const shouldFlushNow =
        state.firstPendingTime !== null &&
        now - state.firstPendingTime >= this.maxWaitMs;

      if (shouldFlushNow) {
        void this.flush(threadId);
      } else {
        state.firstPendingTime ??= now;
        state.debounceTimer = setTimeout(() => {
          void this.flush(threadId);
        }, this.debounceMs);
      }
    });
  }

  /**
   * Force flush any pending edit for a thread.
   * Call this on the final edit to ensure it's sent immediately.
   */
  async flushNow(threadId: string, content: string): Promise<EditResult> {
    const state = this.getOrCreateState(threadId);

    // Cancel any pending debounce
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }

    // If currently executing, wait for it to finish first
    if (state.isExecuting) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (!state.isExecuting) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });
    }

    // Resolve any existing pending resolvers with this final content
    const existingResolvers = [...state.pendingResolvers];
    state.pendingResolvers = [];
    state.pendingContent = null;
    state.firstPendingTime = null;

    // Execute the final edit directly
    const result = await this.executeEdit(threadId, state, content);

    // Resolve all waiting promises
    for (const resolver of existingResolvers) {
      resolver.resolve(result);
    }

    return result;
  }

  /**
   * Check if a thread has a tracked message.
   */
  hasTrackedMessage(threadId: string): boolean {
    const state = this.states.get(threadId);
    return !!state?.currentProcessQueryKey;
  }

  /**
   * Clean up state for a thread.
   */
  cleanup(threadId: string): void {
    const state = this.states.get(threadId);
    if (state?.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }
    this.states.delete(threadId);
  }

  // ─── Private ───────────────────────────────────────────────────────

  private getOrCreateState(threadId: string): EditState {
    let state = this.states.get(threadId);
    if (!state) {
      state = {
        currentProcessQueryKey: undefined,
        pendingContent: null,
        pendingResolvers: [],
        firstPendingTime: null,
        debounceTimer: null,
        isExecuting: false,
      };
      this.states.set(threadId, state);
    }
    return state;
  }

  private async flush(threadId: string): Promise<void> {
    const state = this.states.get(threadId);
    if (!state || state.pendingContent === null || state.isExecuting) {
      return;
    }

    state.isExecuting = true;
    const content = state.pendingContent;
    const resolvers = [...state.pendingResolvers];

    // Clear pending
    state.pendingContent = null;
    state.pendingResolvers = [];
    state.firstPendingTime = null;

    try {
      const result = await this.executeEdit(threadId, state, content);
      for (const resolver of resolvers) {
        resolver.resolve(result);
      }
    } catch (error) {
      for (const resolver of resolvers) {
        resolver.reject(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      state.isExecuting = false;

      // If new pending arrived during execution, flush again
      if (state.pendingContent !== null) {
        void this.flush(threadId);
      }
    }
  }

  /**
   * Execute a single edit: send new message first, then recall old.
   * "Send first, recall later" ensures user always sees latest content.
   */
  private async executeEdit(
    threadId: string,
    state: EditState,
    content: string,
  ): Promise<EditResult> {
    // 1. Send new message first (ensures user sees latest content)
    const result = await this.sendFn(content, threadId);

    // 2. Recall old message (best effort)
    const oldKey = state.currentProcessQueryKey;
    if (oldKey) {
      try {
        await this.recallFn(oldKey, threadId);
      } catch (error) {
        // Recall failure is non-fatal; log and continue
        this.logger?.warn?.("Failed to recall old message during edit", {
          processQueryKey: oldKey,
          error: String(error),
        });
      }
    }

    // 3. Update state with new message
    state.currentProcessQueryKey = result.processQueryKey;

    return result;
  }
}
