/**
 * DingTalk Stream mode support.
 *
 * Stream mode uses WebSocket long-polling instead of HTTP webhooks,
 * eliminating the need for a public IP address.
 *
 * @see https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs
 * @see https://opensource.dingtalk.com/developerpedia/docs/learn/stream/overview
 */

import type { Logger } from "chat";
import type { DingTalkAdapterConfig, DingTalkInboundMessage } from "./types";

/**
 * Stream client configuration.
 */
export interface StreamClientConfig extends DingTalkAdapterConfig {
  /** Enable debug logging in the stream client. */
  debug?: boolean;
  /** Auto reconnect on disconnect (default: true). */
  autoReconnect?: boolean;
  /** Maximum reconnection attempts (default: 10). */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000). */
  initialReconnectDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000). */
  maxReconnectDelay?: number;
}

/**
 * Stream message handler callback.
 */
export type StreamMessageHandler = (
  message: DingTalkInboundMessage,
  acknowledge: () => void,
) => void | Promise<void>;

/**
 * Stream client state.
 */
export type StreamState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stopped";

/**
 * Stream client events.
 */
export interface StreamClientEvents {
  onStateChange?: (state: StreamState, error?: string) => void;
  onMessage?: StreamMessageHandler;
}

/**
 * DingTalk Stream client wrapper.
 *
 * This is a thin wrapper around the official `dingtalk-stream` SDK
 * that integrates with the Chat SDK adapter pattern.
 *
 * @example
 * ```typescript
 * import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
 * import { createStreamClient } from "@chat-adapter/dingtalk";
 *
 * const stream = createStreamClient({
 *   clientId: process.env.DINGTALK_CLIENT_ID!,
 *   clientSecret: process.env.DINGTALK_CLIENT_SECRET!,
 * });
 *
 * stream.onMessage((message, ack) => {
 *   console.log("Received:", message);
 *   ack(); // Acknowledge the message
 * });
 *
 * await stream.connect();
 * ```
 */
export class DingTalkStreamClient {
  private config: StreamClientConfig;
  private logger?: Logger;
  private state: StreamState = "disconnected";
  private events: StreamClientEvents = {};
  private client: any = null;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(config: StreamClientConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Get current connection state.
   */
  getState(): StreamState {
    return this.state;
  }

  /**
   * Register state change handler.
   */
  onStateChange(handler: StreamClientEvents["onStateChange"]): this {
    this.events.onStateChange = handler;
    return this;
  }

  /**
   * Register message handler.
   */
  onMessage(handler: StreamMessageHandler): this {
    this.events.onMessage = handler;
    return this;
  }

  /**
   * Connect to DingTalk Stream.
   *
   * Requires the `dingtalk-stream` package to be installed:
   * ```bash
   * pnpm add dingtalk-stream
   * ```
   */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    this.stopped = false;
    this.setState("connecting");

    try {
      // Dynamic import to make dingtalk-stream an optional peer dependency.
      const { DWClient, TOPIC_ROBOT } = await import("dingtalk-stream");

      this.client = new DWClient({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        debug: this.config.debug ?? false,
        keepAlive: false,
      });

      // Disable built-in reconnect; we manage it ourselves.
      (this.client as any).config.autoReconnect = false;

      // Register message callback.
      this.client.registerCallbackListener(TOPIC_ROBOT, async (res: any) => {
        const messageId = res.headers?.messageId;

        const acknowledge = () => {
          if (!messageId) return;
          try {
            this.client.socketCallBackResponse(messageId, { success: true });
          } catch (error) {
            this.logger?.warn?.("Failed to acknowledge message", {
              messageId,
              error: String(error),
            });
          }
        };

        try {
          const data = JSON.parse(res.data) as DingTalkInboundMessage;
          await this.events.onMessage?.(data, acknowledge);
        } catch (error) {
          this.logger?.error?.("Failed to process stream message", {
            error: String(error),
          });
          acknowledge(); // Still ack to prevent redelivery.
        }
      });

      await this.client.connect();
      this.reconnectAttempts = 0;
      this.setState("connected");

      this.logger?.info?.("DingTalk Stream connected", {
        clientId: this.config.clientId,
      });

      // Set up disconnect handler for auto-reconnect.
      this.setupDisconnectHandler();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.setState("disconnected", errorMsg);

      if (this.shouldReconnect()) {
        this.scheduleReconnect();
      } else {
        throw error;
      }
    }
  }

  /**
   * Disconnect from DingTalk Stream.
   */
  async disconnect(): Promise<void> {
    this.stopped = true;
    this.clearReconnectTimer();

    if (this.client) {
      try {
        await this.client.disconnect?.();
      } catch (error) {
        this.logger?.warn?.("Error during disconnect", {
          error: String(error),
        });
      }
      this.client = null;
    }

    this.setState("stopped");
    this.logger?.info?.("DingTalk Stream disconnected");
  }

  private setState(state: StreamState, error?: string): void {
    this.state = state;
    this.events.onStateChange?.(state, error);
  }

  private shouldReconnect(): boolean {
    if (this.stopped) return false;
    if (this.config.autoReconnect === false) return false;

    const maxAttempts = this.config.maxReconnectAttempts ?? 10;
    return this.reconnectAttempts < maxAttempts;
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.setState("reconnecting");

    const initialDelay = this.config.initialReconnectDelay ?? 1000;
    const maxDelay = this.config.maxReconnectDelay ?? 30000;

    // Exponential backoff with jitter.
    const baseDelay = Math.min(
      initialDelay * 2 ** this.reconnectAttempts,
      maxDelay,
    );
    const jitter = baseDelay * 0.2 * (Math.random() - 0.5);
    const delay = Math.round(baseDelay + jitter);

    this.logger?.info?.("Scheduling reconnect", {
      attempt: this.reconnectAttempts + 1,
      delayMs: delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
      } catch (error) {
        this.logger?.error?.("Reconnect failed", {
          attempt: this.reconnectAttempts,
          error: String(error),
        });
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private setupDisconnectHandler(): void {
    if (!this.client) return;

    // Access internal socket if available.
    const socket = (this.client as any).socket;
    if (!socket) return;

    socket.on?.("close", (code: number, reason: string) => {
      if (this.stopped) return;

      this.logger?.warn?.("Stream socket closed", { code, reason });
      this.setState("disconnected", `Socket closed: ${code}`);

      if (this.shouldReconnect()) {
        this.scheduleReconnect();
      }
    });

    socket.on?.("error", (error: Error) => {
      this.logger?.error?.("Stream socket error", { error: error.message });
    });
  }
}

/**
 * Create a DingTalk Stream client.
 *
 * @example
 * ```typescript
 * const stream = createStreamClient({
 *   clientId: process.env.DINGTALK_CLIENT_ID!,
 *   clientSecret: process.env.DINGTALK_CLIENT_SECRET!,
 * });
 *
 * stream.onMessage(async (message, ack) => {
 *   // Process message...
 *   ack();
 * });
 *
 * await stream.connect();
 * ```
 */
export function createStreamClient(
  config: StreamClientConfig,
  logger?: Logger,
): DingTalkStreamClient {
  return new DingTalkStreamClient(config, logger);
}
