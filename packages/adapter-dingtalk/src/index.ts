/**
 * @chat-adapter/dingtalk
 *
 * DingTalk adapter for Chat SDK.
 * Supports robot webhook messages, session replies, proactive messages,
 * markdown formatting, and interactive ActionCards.
 *
 * @see https://open.dingtalk.com/document/orgapp/robot-overview
 */

import {
  cardToFallbackText,
  extractCard,
  extractFiles,
  NetworkError,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  ChannelInfo,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  Message,
  NotImplementedError,
} from "chat";
import { getAccessToken } from "./auth";
import {
  cardToDingTalkActionCard,
  decodeDingTalkCallbackData,
} from "./cards";
import { DingTalkFormatConverter } from "./markdown";
import type {
  DingTalkAdapterConfig,
  DingTalkCardCallback,
  DingTalkInboundMessage,
  DingTalkProactivePayload,
  DingTalkRawMessage,
  DingTalkThreadId,
} from "./types";

const DINGTALK_API_BASE = "https://api.dingtalk.com";
const DINGTALK_MESSAGE_LIMIT = 20000;
const TRAILING_SLASHES_REGEX = /\/+$/;

interface DingTalkMessageAuthor {
  fullName: string;
  isBot: boolean | "unknown";
  isMe: boolean;
  userId: string;
  userName: string;
}

/**
 * Create a DingTalk adapter for Chat SDK.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createDingTalkAdapter } from "@chat-adapter/dingtalk";
 *
 * const bot = new Chat({
 *   userName: "mybot",
 *   adapters: {
 *     dingtalk: createDingTalkAdapter({
 *       clientId: process.env.DINGTALK_CLIENT_ID!,
 *       clientSecret: process.env.DINGTALK_CLIENT_SECRET!,
 *     }),
 *   },
 * });
 * ```
 */
export function createDingTalkAdapter(
  config: DingTalkAdapterConfig,
): DingTalkAdapter {
  return new DingTalkAdapter(config);
}

export class DingTalkAdapter
  implements Adapter<DingTalkThreadId, DingTalkRawMessage>
{
  readonly name = "dingtalk";

  private readonly config: DingTalkAdapterConfig;
  private readonly apiBaseUrl: string;
  private readonly logger: Logger;
  private readonly formatConverter = new DingTalkFormatConverter();
  private readonly messageCache = new Map<
    string,
    Message<DingTalkRawMessage>[]
  >();
  /** Session webhook cache: threadId -> webhook URL (short-lived). */
  private readonly sessionWebhookCache = new Map<string, string>();

  private chat: ChatInstance | null = null;
  private _botUserId?: string;
  private _userName: string;

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  get userName(): string {
    return this._userName;
  }

  constructor(config: DingTalkAdapterConfig & { logger?: Logger; userName?: string }) {
    this.config = config;
    this.apiBaseUrl = (config.apiBaseUrl ?? DINGTALK_API_BASE).replace(
      TRAILING_SLASHES_REGEX,
      "",
    );
    this.logger = (config as any).logger ?? new ConsoleLogger();
    this._userName = (config as any).userName ?? "bot";
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this._userName = chat.getUserName();

    // Verify credentials by fetching an access token.
    try {
      await getAccessToken(this.config, this.logger);
      this.logger.info("DingTalk adapter initialized", {
        clientId: this.config.clientId,
        userName: this._userName,
      });
    } catch (error) {
      this.logger.warn("Failed to verify DingTalk credentials", {
        error: String(error),
      });
    }
  }

  // ─── Webhook Handling ──────────────────────────────────────────────

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    let payload: DingTalkInboundMessage | DingTalkCardCallback;
    try {
      payload = (await request.json()) as
        | DingTalkInboundMessage
        | DingTalkCardCallback;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring DingTalk webhook",
      );
      return new Response("OK", { status: 200 });
    }

    // Distinguish between message callback and card callback.
    if ("msgId" in payload) {
      this.handleIncomingMessage(payload, options);
    } else if ("outTrackId" in payload) {
      this.handleCardCallback(payload, options);
    }

    // DingTalk expects an empty JSON response for webhook acknowledgement.
    return new Response(JSON.stringify({ msgtype: "empty" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  private handleIncomingMessage(
    msg: DingTalkInboundMessage,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) return;

    const conversationType =
      msg.conversationType === "2" ? "2" : ("1" as const);
    const threadId = this.encodeThreadId({
      conversationId:
        conversationType === "2" ? msg.conversationId : msg.senderId,
      conversationType,
    });

    // Cache the session webhook for replies.
    if (msg.sessionWebhook) {
      this.sessionWebhookCache.set(threadId, msg.sessionWebhook);
    }

    // Store bot userId from the first message.
    if (!this._botUserId && msg.chatbotUserId) {
      this._botUserId = msg.chatbotUserId;
    }

    const parsedMessage = this.parseDingTalkMessage(msg, threadId);
    this.cacheMessage(parsedMessage);

    this.chat.processMessage(this, threadId, parsedMessage, options);
  }

  private handleCardCallback(
    callback: DingTalkCardCallback,
    options?: WebhookOptions,
  ): void {
    if (!this.chat) return;

    const conversationType =
      callback.conversationType === "2" ? "2" : ("1" as const);
    const threadId = this.encodeThreadId({
      conversationId:
        callback.conversationId ?? callback.userId,
      conversationType,
    });

    const { actionId, value } = decodeDingTalkCallbackData(callback.content);

    this.chat.processAction(
      {
        adapter: this,
        actionId,
        value,
        messageId: callback.outTrackId,
        threadId,
        user: {
          userId: callback.userId,
          userName: callback.userId,
          fullName: callback.userId,
          isBot: false,
          isMe: false,
        },
        raw: callback,
      },
      options,
    );
  }

  // ─── Message Posting ───────────────────────────────────────────────

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<DingTalkRawMessage>> {
    const parsedThread = this.resolveThreadId(threadId);

    const card = extractCard(message);
    const text = this.truncateMessage(
      convertEmojiPlaceholders(
        card
          ? cardToFallbackText(card)
          : this.formatConverter.renderPostable(message),
        "gchat",
      ),
    );

    if (!text.trim()) {
      throw new ValidationError("dingtalk", "Message text cannot be empty");
    }

    // Try session webhook first (faster, no auth needed).
    const sessionWebhook = this.sessionWebhookCache.get(threadId);
    if (sessionWebhook) {
      return this.sendViaSessionWebhook(
        sessionWebhook,
        text,
        card,
        parsedThread,
        threadId,
      );
    }

    // Fall back to proactive message API.
    return this.sendViaProactiveApi(text, parsedThread, threadId);
  }

  private async sendViaSessionWebhook(
    webhookUrl: string,
    text: string,
    card: ReturnType<typeof extractCard>,
    thread: DingTalkThreadId,
    threadId: string,
  ): Promise<RawMessage<DingTalkRawMessage>> {
    const actionCard = card
      ? cardToDingTalkActionCard(card, text)
      : undefined;

    let body: Record<string, unknown>;
    if (actionCard) {
      body = { msgtype: "actionCard", actionCard };
    } else {
      body = {
        msgtype: "markdown",
        markdown: {
          title: text.slice(0, 20) || "消息",
          text,
        },
      };
    }

    const token = await getAccessToken(this.config, this.logger);

    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": token,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new NetworkError(
        "dingtalk",
        "Failed to send message via session webhook",
        error instanceof Error ? error : undefined,
      );
    }

    if (!response.ok) {
      throw new NetworkError(
        "dingtalk",
        `Session webhook failed: ${response.status} ${response.statusText}`,
      );
    }

    // DingTalk session webhook doesn't return a message ID,
    // so we generate a synthetic one.
    const syntheticId = `dingtalk:${thread.conversationId}:${Date.now()}`;
    const syntheticRaw: DingTalkInboundMessage = {
      msgId: syntheticId,
      msgtype: "text",
      createAt: Date.now(),
      text: { content: text },
      conversationType: thread.conversationType,
      conversationId: thread.conversationId,
      senderId: this._botUserId ?? "bot",
      senderNick: this._userName,
      chatbotUserId: this._botUserId ?? "bot",
      sessionWebhook: webhookUrl,
    };

    return {
      id: syntheticId,
      threadId,
      raw: syntheticRaw,
    };
  }

  private async sendViaProactiveApi(
    text: string,
    thread: DingTalkThreadId,
    threadId: string,
  ): Promise<RawMessage<DingTalkRawMessage>> {
    const token = await getAccessToken(this.config, this.logger);
    const robotCode = this.config.robotCode ?? this.config.clientId;
    const isGroup = thread.conversationType === "2";

    const url = isGroup
      ? `${this.apiBaseUrl}/v1.0/robot/groupMessages/send`
      : `${this.apiBaseUrl}/v1.0/robot/oToMessages/batchSend`;

    const payload: DingTalkProactivePayload = {
      robotCode,
      msgKey: "sampleMarkdown",
      msgParam: JSON.stringify({
        title: text.slice(0, 20) || "消息",
        text,
      }),
    };

    if (isGroup) {
      payload.openConversationId = thread.conversationId;
    } else {
      payload.userIds = [thread.conversationId];
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": token,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new NetworkError(
        "dingtalk",
        "Failed to send proactive message",
        error instanceof Error ? error : undefined,
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new NetworkError(
        "dingtalk",
        `Proactive message failed: ${response.status} ${errorText}`,
      );
    }

    const result = (await response.json()) as Record<string, unknown>;
    const messageId =
      (result.processQueryKey as string) ??
      `dingtalk:${thread.conversationId}:${Date.now()}`;

    const syntheticRaw: DingTalkInboundMessage = {
      msgId: messageId,
      msgtype: "text",
      createAt: Date.now(),
      text: { content: text },
      conversationType: thread.conversationType,
      conversationId: thread.conversationId,
      senderId: this._botUserId ?? "bot",
      senderNick: this._userName,
      chatbotUserId: this._botUserId ?? "bot",
      sessionWebhook: "",
    };

    return {
      id: messageId,
      threadId,
      raw: syntheticRaw,
    };
  }

  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<DingTalkRawMessage>> {
    const threadId = this.encodeThreadId({
      conversationId: channelId,
      conversationType: "2",
    });
    return this.postMessage(threadId, message);
  }

  // ─── Message Editing ───────────────────────────────────────────────

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<DingTalkRawMessage>> {
    // DingTalk doesn't support editing messages natively.
    // We post a new message as a workaround (post+edit streaming pattern).
    this.logger.warn(
      "DingTalk does not support message editing; posting new message instead",
      { threadId, messageId },
    );
    return this.postMessage(threadId, message);
  }

  // ─── Message Deletion ──────────────────────────────────────────────

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    // DingTalk robot API does not support message deletion.
    this.logger.warn("DingTalk does not support message deletion", {
      threadId,
      messageId,
    });
  }

  // ─── Reactions ─────────────────────────────────────────────────────

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // DingTalk robot API does not support reactions.
    throw new NotImplementedError(
      "DingTalk does not support reactions",
      "addReaction",
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    throw new NotImplementedError(
      "DingTalk does not support reactions",
      "removeReaction",
    );
  }

  // ─── Typing Indicator ──────────────────────────────────────────────

  async startTyping(_threadId: string): Promise<void> {
    // DingTalk does not have a typing indicator API.
    // No-op for compatibility.
  }

  // ─── Message Fetching ──────────────────────────────────────────────

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {},
  ): Promise<FetchResult<DingTalkRawMessage>> {
    // DingTalk robot API doesn't provide message history.
    // Return cached messages only.
    const messages = [
      ...(this.messageCache.get(threadId) ?? []),
    ].sort((a, b) => this.compareMessages(a, b));

    return this.paginateMessages(messages, options);
  }

  async fetchMessage(
    _threadId: string,
    messageId: string,
  ): Promise<Message<DingTalkRawMessage> | null> {
    return this.findCachedMessage(messageId) ?? null;
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const parsed = this.resolveThreadId(threadId);

    return {
      id: threadId,
      channelId: parsed.conversationId,
      channelName: parsed.conversationId,
      isDM: parsed.conversationType === "1",
      metadata: { parsed },
    };
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    return {
      id: channelId,
      name: channelId,
      isDM: false,
      metadata: {},
    };
  }

  // ─── DM Support ────────────────────────────────────────────────────

  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({
      conversationId: userId,
      conversationType: "1",
    });
  }

  isDM(threadId: string): boolean {
    const { conversationType } = this.resolveThreadId(threadId);
    return conversationType === "1";
  }

  // ─── Thread ID Encoding ────────────────────────────────────────────

  encodeThreadId(platformData: DingTalkThreadId): string {
    return `dingtalk:${platformData.conversationType}:${platformData.conversationId}`;
  }

  decodeThreadId(threadId: string): DingTalkThreadId {
    const parts = threadId.split(":");
    if (parts[0] !== "dingtalk" || parts.length < 3) {
      throw new ValidationError(
        "dingtalk",
        `Invalid DingTalk thread ID: ${threadId}`,
      );
    }

    const conversationType = parts[1] as "1" | "2";
    const conversationId = parts.slice(2).join(":");

    if (!conversationId) {
      throw new ValidationError(
        "dingtalk",
        `Invalid DingTalk thread ID: ${threadId}`,
      );
    }

    return { conversationId, conversationType };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.resolveThreadId(threadId).conversationId;
  }

  // ─── Message Parsing ───────────────────────────────────────────────

  parseMessage(raw: DingTalkRawMessage): Message<DingTalkRawMessage> {
    const conversationType =
      raw.conversationType === "2" ? "2" : ("1" as const);
    const threadId = this.encodeThreadId({
      conversationId:
        conversationType === "2" ? raw.conversationId : raw.senderId,
      conversationType,
    });

    const message = this.parseDingTalkMessage(raw, threadId);
    this.cacheMessage(message);
    return message;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  // ─── Private Helpers ───────────────────────────────────────────────

  private parseDingTalkMessage(
    raw: DingTalkInboundMessage,
    threadId: string,
  ): Message<DingTalkRawMessage> {
    const text = this.extractMessageText(raw);
    const author: DingTalkMessageAuthor = {
      userId: raw.senderId,
      userName: raw.senderNick ?? raw.senderId,
      fullName: raw.senderNick ?? raw.senderId,
      isBot: raw.senderId === this._botUserId,
      isMe: raw.senderId === this._botUserId,
    };

    const message = new Message<DingTalkRawMessage>({
      id: raw.msgId,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      author,
      metadata: {
        dateSent: new Date(raw.createAt),
        edited: false,
      },
      attachments: this.extractAttachments(raw),
      isMention: true, // DingTalk robot messages are always mentions.
    });

    return message;
  }

  private extractMessageText(msg: DingTalkInboundMessage): string {
    if (msg.text?.content) {
      return msg.text.content.trim();
    }

    // Handle richText messages.
    if (msg.content?.richText) {
      return msg.content.richText
        .filter((item) => item.text)
        .map((item) => item.text)
        .join("")
        .trim();
    }

    // Handle audio recognition.
    if (msg.content?.recognition) {
      return msg.content.recognition;
    }

    return "";
  }

  private extractAttachments(raw: DingTalkInboundMessage): Attachment[] {
    const attachments: Attachment[] = [];

    if (raw.msgtype === "picture" && raw.content?.downloadCode) {
      attachments.push({
        type: "image",
        url: raw.content.downloadCode,
        name: raw.content.fileName,
      });
    }

    if (raw.msgtype === "video" && raw.content?.downloadCode) {
      attachments.push({
        type: "video",
        url: raw.content.downloadCode,
        name: raw.content.fileName,
      });
    }

    if (raw.msgtype === "audio" && raw.content?.downloadCode) {
      attachments.push({
        type: "audio",
        url: raw.content.downloadCode,
        name: raw.content.fileName,
      });
    }

    if (raw.msgtype === "file" && raw.content?.downloadCode) {
      attachments.push({
        type: "file",
        url: raw.content.downloadCode,
        name: raw.content.fileName,
      });
    }

    // Handle images in richText.
    if (raw.msgtype === "richText" && raw.content?.richText) {
      for (const item of raw.content.richText) {
        if (item.type === "picture" && item.downloadCode) {
          attachments.push({
            type: "image",
            url: item.downloadCode,
          });
        }
      }
    }

    return attachments;
  }

  private resolveThreadId(threadId: string): DingTalkThreadId {
    return this.decodeThreadId(threadId);
  }

  private truncateMessage(text: string): string {
    if (text.length <= DINGTALK_MESSAGE_LIMIT) {
      return text;
    }
    return text.slice(0, DINGTALK_MESSAGE_LIMIT - 3) + "...";
  }

  private cacheMessage(message: Message<DingTalkRawMessage>): void {
    const existing = this.messageCache.get(message.threadId) ?? [];
    const index = existing.findIndex((m) => m.id === message.id);
    if (index >= 0) {
      existing[index] = message;
    } else {
      existing.push(message);
    }
    this.messageCache.set(message.threadId, existing);
  }

  private findCachedMessage(
    messageId: string,
  ): Message<DingTalkRawMessage> | undefined {
    for (const messages of this.messageCache.values()) {
      const found = messages.find((m) => m.id === messageId);
      if (found) return found;
    }
    return undefined;
  }

  private deleteCachedMessage(messageId: string): void {
    for (const [threadId, messages] of this.messageCache.entries()) {
      const filtered = messages.filter((m) => m.id !== messageId);
      if (filtered.length !== messages.length) {
        this.messageCache.set(threadId, filtered);
        return;
      }
    }
  }

  private compareMessages(
    a: Message<DingTalkRawMessage>,
    b: Message<DingTalkRawMessage>,
  ): number {
    const dateA = a.metadata?.dateSent?.getTime() ?? 0;
    const dateB = b.metadata?.dateSent?.getTime() ?? 0;
    return dateA - dateB;
  }

  private paginateMessages(
    messages: Message<DingTalkRawMessage>[],
    options: FetchOptions,
  ): FetchResult<DingTalkRawMessage> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const direction = options.direction ?? "backward";

    if (messages.length === 0) {
      return { messages: [] };
    }

    const messageIndexById = new Map(
      messages.map((message, index) => [message.id, index]),
    );

    if (direction === "backward") {
      const end =
        options.cursor && messageIndexById.has(options.cursor)
          ? (messageIndexById.get(options.cursor) ?? messages.length)
          : messages.length;
      const start = Math.max(0, end - limit);
      const page = messages.slice(start, end);

      return {
        messages: page,
        nextCursor: start > 0 ? page[0]?.id : undefined,
      };
    }

    // Forward direction.
    const start =
      options.cursor && messageIndexById.has(options.cursor)
        ? (messageIndexById.get(options.cursor) ?? 0) + 1
        : 0;
    const end = Math.min(start + limit, messages.length);
    const page = messages.slice(start, end);

    return {
      messages: page,
      nextCursor: end < messages.length ? page[page.length - 1]?.id : undefined,
    };
  }
}

export type { DingTalkAdapterConfig, DingTalkThreadId, DingTalkRawMessage } from "./types";
export { getAccessToken } from "./auth";
export {
  createStreamClient,
  DingTalkStreamClient,
  TOPIC_ROBOT,
  TOPIC_CARD,
  type StreamClientConfig,
  type StreamMessageHandler,
  type StreamState,
  type StreamClientEvents,
} from "./stream";
