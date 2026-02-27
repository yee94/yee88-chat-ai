// src/chat/polling.ts - Telegram Long Polling 实现
import { consola } from "consola";

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
    };
    message_thread_id?: number;
    date: number;
    text?: string;
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    message?: TelegramUpdate["message"];
    data?: string;
  };
}

export interface PollingOptions {
  botToken: string;
  timeout?: number; // 长轮询超时，默认 30 秒
  allowedUpdates?: string[];
  onUpdate: (update: TelegramUpdate) => Promise<void>;
  onError?: (error: Error) => void;
}

export class TelegramPoller {
  private botToken: string;
  private timeout: number;
  private allowedUpdates: string[];
  private onUpdate: (update: TelegramUpdate) => Promise<void>;
  private onError: (error: Error) => void;
  private offset: number | null = null;
  private running = false;
  private abortController: AbortController | null = null;

  constructor(options: PollingOptions) {
    this.botToken = options.botToken;
    this.timeout = options.timeout ?? 30;
    this.allowedUpdates = options.allowedUpdates ?? ["message", "callback_query"];
    this.onUpdate = options.onUpdate;
    this.onError = options.onError ?? ((err) => consola.error("[polling] error:", err));
  }

  private get apiBase(): string {
    return `https://api.telegram.org/bot${this.botToken}`;
  }

  /** 调用 getUpdates API */
  private async getUpdates(): Promise<TelegramUpdate[] | null> {
    const params = new URLSearchParams({
      timeout: String(this.timeout),
      allowed_updates: JSON.stringify(this.allowedUpdates),
    });
    if (this.offset !== null) {
      params.set("offset", String(this.offset));
    }

    try {
      const resp = await fetch(`${this.apiBase}/getUpdates?${params}`, {
        signal: this.abortController?.signal,
      });
      const data = (await resp.json()) as { ok: boolean; result?: TelegramUpdate[]; description?: string; error_code?: number };
      if (!data.ok) {
        consola.error("[polling] API error:", data.error_code, data.description);
        return null;
      }
      if (!data.result) {
        consola.warn("[polling] API returned ok but no result");
        return null;
      }
      return data.result;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return null;
      }
      consola.error("[polling] fetch error:", err);
      throw err;
    }
  }

  /** 清空积压的旧消息，并初始化 offset */
  private async drainBacklog(): Promise<void> {
    consola.info("[polling] draining backlog...");
    const params = new URLSearchParams({
      timeout: "0",
      allowed_updates: JSON.stringify(this.allowedUpdates),
      offset: "-1", // 获取最新一条
    });

    try {
      const resp = await fetch(`${this.apiBase}/getUpdates?${params}`);
      const data = (await resp.json()) as { ok: boolean; result?: TelegramUpdate[] };
      if (data.ok && data.result && data.result.length > 0) {
        const lastUpdate = data.result[data.result.length - 1];
        if (!lastUpdate) return;
        this.offset = lastUpdate.update_id + 1;
        consola.info(`[polling] skipped ${data.result.length} old updates, offset=${this.offset}`);
      } else {
        // 没有积压消息，设置 offset 为 0 以获取所有新消息
        this.offset = 0;
        consola.info("[polling] no backlog, starting fresh");
      }
    } catch (err) {
      consola.warn("[polling] failed to drain backlog:", err);
      this.offset = 0; // 失败时也初始化 offset
    }
  }

  /** 启动轮询 */
  async start(): Promise<void> {
    if (this.running) {
      consola.warn("[polling] already running");
      return;
    }

    this.running = true;
    this.abortController = new AbortController();

    // 先清空积压消息
    await this.drainBacklog();

    consola.info("[polling] started");

    while (this.running) {
      try {
        consola.info("[polling] fetching updates, offset:", this.offset);
        const updates = await this.getUpdates();
        if (updates === null) {
          consola.info("[polling] getUpdates returned null");
          if (this.running) {
            await Bun.sleep(2000); // 失败后等待 2 秒重试
          }
          continue;
        }

        if (updates.length > 0) {
          consola.info(`[polling] received ${updates.length} update(s)`);
        }

        for (const update of updates) {
          this.offset = update.update_id + 1;
          consola.info("[polling] processing update:", update.update_id, update.message?.text?.slice(0, 50));
          try {
            await this.onUpdate(update);
          } catch (err) {
            this.onError(err as Error);
          }
        }
      } catch (err) {
        consola.error("[polling] loop error:", err);
        this.onError(err as Error);
        if (this.running) {
          await Bun.sleep(2000);
        }
      }
    }
  }

  /** 停止轮询 */
  stop(): void {
    consola.info("[polling] stopping...");
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
  }
}