/**
 * DingTalk Stream mode client.
 *
 * Native implementation without external dependencies.
 * Uses WebSocket long-polling instead of HTTP webhooks,
 * eliminating the need for a public IP address.
 *
 * @see https://opensource.dingtalk.com/developerpedia/docs/learn/stream/overview
 */

import type { Logger } from "chat";
import type { DingTalkAdapterConfig, DingTalkInboundMessage } from "./types";

// DingTalk Stream API endpoints
const GATEWAY_URL = "https://api.dingtalk.com/v1.0/gateway/connections/open";

/** Robot message callback topic */
export const TOPIC_ROBOT = "/v1.0/im/bot/messages/get";

/** Card callback topic */
export const TOPIC_CARD = "/v1.0/card/instances/callback";

/**
 * Stream client configuration.
 */
export interface StreamClientConfig extends DingTalkAdapterConfig {
  /** Enable debug logging. */
  debug?: boolean;
  /** Auto reconnect on disconnect (default: true). */
  autoReconnect?: boolean;
  /** Maximum reconnection attempts (default: 10). */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000). */
  initialReconnectDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000). */
  maxReconnectDelay?: number;
  /** Subscriptions (default: robot messages). */
  subscriptions?: Array<{ type: "EVENT" | "CALLBACK"; topic: string }>;
}

/**
 * Stream downstream message from DingTalk.
 */
export interface StreamDownstreamMessage {
  specVersion: string;
  type: string;
  headers: {
    appId: string;
    connectionId: string;
    contentType: string;
    messageId: string;
    time: string;
    topic: string;
    eventType?: string;
    eventBornTime?: string;
    eventId?: string;
    eventCorpId?: string;
  };
  data: string;
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
  onRawMessage?: (msg: StreamDownstreamMessage) => void;
}

/**
 * DingTalk Stream client.
 *
 * Native WebSocket implementation for receiving robot messages
 * without requiring a public webhook endpoint.
 *
 * @example
 * ```typescript
 * import { createStreamClient, TOPIC_ROBOT } from "@chat-adapter/dingtalk";
 *
 * const stream = createStreamClient({
 *   clientId: process.env.DINGTALK_CLIENT_ID!,
 *   clientSecret: process.env.DINGTALK_CLIENT_SECRET!,
 * });
 *
 * stream.onMessage((message, ack) => {
 *   console.log("Received:", message);
 *   ack();
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
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private connectionId?: string;

  /** Message deduplication cache (msgId -> timestamp). */
  private readonly processedMessages = new Map<string, number>();
  /** Max age for dedup entries (5 minutes). */
  private readonly dedupMaxAge = 5 * 60 * 1000;
  /** Max entries in dedup cache. */
  private readonly dedupMaxSize = 1000;

  private readonly heartbeatInterval = 10000; // 10 seconds
  private readonly defaultSubscriptions = [
    { type: "CALLBACK" as const, topic: TOPIC_ROBOT },
  ];

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
   * Register message handler for robot messages.
   */
  onMessage(handler: StreamMessageHandler): this {
    this.events.onMessage = handler;
    return this;
  }

  /**
   * Register raw message handler for all downstream messages.
   */
  onRawMessage(handler: StreamClientEvents["onRawMessage"]): this {
    this.events.onRawMessage = handler;
    return this;
  }

  /**
   * Connect to DingTalk Stream.
   */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    this.stopped = false;
    this.setState("connecting");

    try {
      // Get WebSocket endpoint from gateway
      const endpoint = await this.getEndpoint();
      this.log("debug", "Got stream endpoint", { endpoint });

      // Connect WebSocket
      await this.connectWebSocket(endpoint);

      this.reconnectAttempts = 0;
      this.setState("connected");
      this.log("info", "DingTalk Stream connected", {
        clientId: this.config.clientId,
        connectionId: this.connectionId,
      });

      // Start heartbeat
      this.startHeartbeat();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log("error", "Connection failed", { error: errorMsg });
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
    this.clearTimers();

    if (this.socket) {
      try {
        this.socket.close(1000, "Client disconnect");
      } catch {
        // Ignore close errors
      }
      this.socket = null;
    }

    this.setState("stopped");
    this.log("info", "DingTalk Stream disconnected");
  }

  /**
   * Send acknowledgement for a message.
   */
  sendAck(messageId: string, success = true): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.log("warn", "Cannot send ack, socket not open", { messageId });
      return;
    }

    const response = {
      code: success ? 200 : 500,
      headers: { contentType: "application/json" },
      message: success ? "OK" : "FAIL",
      data: JSON.stringify({ success }),
    };

    this.socket.send(
      JSON.stringify({
        specVersion: "1.0",
        type: "SYSTEM",
        headers: {
          messageId,
          contentType: "application/json",
        },
        data: JSON.stringify(response),
      }),
    );
  }

  // ─── Private Methods ───────────────────────────────────────────────

  private async getEndpoint(): Promise<string> {
    const subscriptions =
      this.config.subscriptions ?? this.defaultSubscriptions;

    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        subscriptions,
        ua: "chat-adapter-dingtalk/0.1.0",
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Failed to get stream endpoint: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as {
      endpoint: string;
      ticket: string;
    };

    if (!data.endpoint) {
      throw new Error("No endpoint in gateway response");
    }

    // Append ticket to endpoint URL
    const url = new URL(data.endpoint);
    url.searchParams.set("ticket", data.ticket);
    return url.toString();
  }

  private connectWebSocket(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(endpoint);
      } catch (error) {
        reject(error);
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("WebSocket connection timeout"));
        this.socket?.close();
      }, 30000);

      this.socket.onopen = () => {
        clearTimeout(timeout);
        this.log("debug", "WebSocket opened");
        resolve();
      };

      this.socket.onerror = (event) => {
        clearTimeout(timeout);
        const error = new Error("WebSocket error");
        this.log("error", "WebSocket error", { event });
        reject(error);
      };

      this.socket.onclose = (event) => {
        clearTimeout(timeout);
        this.log("info", "WebSocket closed", {
          code: event.code,
          reason: event.reason,
        });
        this.handleDisconnect(event.code, event.reason);
      };

      this.socket.onmessage = (event) => {
        this.handleMessage(event.data as string);
      };
    });
  }

  private handleMessage(data: string): void {
    let msg: StreamDownstreamMessage;
    try {
      msg = JSON.parse(data) as StreamDownstreamMessage;
    } catch {
      this.log("warn", "Failed to parse stream message", { data });
      return;
    }

    // Handle system messages (connection info, pong, etc.)
    if (msg.type === "SYSTEM") {
      this.handleSystemMessage(msg);
      return;
    }

    // Emit raw message event
    this.events.onRawMessage?.(msg);

    // Handle robot callback messages
    if (
      msg.headers.topic === TOPIC_ROBOT &&
      msg.type === "CALLBACK"
    ) {
      this.handleRobotMessage(msg);
    }
  }

  private handleSystemMessage(msg: StreamDownstreamMessage): void {
    try {
      const data = JSON.parse(msg.data) as Record<string, unknown>;

      // Connection established message
      if (data.connectionId) {
        this.connectionId = data.connectionId as string;
        this.log("debug", "Connection ID received", {
          connectionId: this.connectionId,
        });
      }
    } catch {
      // Ignore parse errors for system messages
    }
  }

  private handleRobotMessage(msg: StreamDownstreamMessage): void {
    const messageId = msg.headers.messageId;

    const acknowledge = () => {
      this.sendAck(messageId, true);
    };

    try {
      const robotMsg = JSON.parse(msg.data) as DingTalkInboundMessage;

      // Deduplication: check if we've already processed this message
      const dedupKey = robotMsg.msgId || messageId;
      if (this.isMessageProcessed(dedupKey)) {
        this.log("debug", "Skipping duplicate message", { dedupKey });
        acknowledge();
        return;
      }
      this.markMessageProcessed(dedupKey);

      this.events.onMessage?.(robotMsg, acknowledge);
    } catch (error) {
      this.log("error", "Failed to parse robot message", {
        error: String(error),
        data: msg.data,
      });
      // Still acknowledge to prevent redelivery
      acknowledge();
    }
  }

  /**
   * Check if a message has already been processed.
   */
  private isMessageProcessed(msgId: string): boolean {
    return this.processedMessages.has(msgId);
  }

  /**
   * Mark a message as processed and clean up old entries.
   */
  private markMessageProcessed(msgId: string): void {
    const now = Date.now();
    this.processedMessages.set(msgId, now);

    // Cleanup old entries if cache is too large
    if (this.processedMessages.size > this.dedupMaxSize) {
      const cutoff = now - this.dedupMaxAge;
      for (const [key, timestamp] of this.processedMessages) {
        if (timestamp < cutoff) {
          this.processedMessages.delete(key);
        }
      }
    }
  }

  private handleDisconnect(code: number, reason: string): void {
    this.clearTimers();
    this.socket = null;

    if (this.stopped) {
      return;
    }

    this.setState("disconnected", `Socket closed: ${code} ${reason}`);

    if (this.shouldReconnect()) {
      this.scheduleReconnect();
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(
          JSON.stringify({
            specVersion: "1.0",
            type: "SYSTEM",
            headers: { type: "ping" },
            data: "",
          }),
        );
      }
    }, this.heartbeatInterval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    this.clearReconnectTimer();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
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

    // Exponential backoff with jitter
    const baseDelay = Math.min(
      initialDelay * 2 ** this.reconnectAttempts,
      maxDelay,
    );
    const jitter = baseDelay * 0.2 * (Math.random() - 0.5);
    const delay = Math.round(baseDelay + jitter);

    this.log("info", "Scheduling reconnect", {
      attempt: this.reconnectAttempts + 1,
      delayMs: delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
      } catch (error) {
        this.log("error", "Reconnect failed", {
          attempt: this.reconnectAttempts,
          error: String(error),
        });
      }
    }, delay);
  }

  private setState(state: StreamState, error?: string): void {
    this.state = state;
    this.events.onStateChange?.(state, error);
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (this.config.debug || level !== "debug") {
      this.logger?.[level]?.(message, data);
    }
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
 *   console.log("Received:", message.text?.content);
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
