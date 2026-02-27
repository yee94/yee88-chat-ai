import { ValidationError } from "@chat-adapter/shared";
import type { ChatInstance, Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeDingTalkCallbackData } from "./cards";
import { clearTokenCache } from "./auth";
import { createDingTalkAdapter, DingTalkAdapter } from "./index";
import type { DingTalkInboundMessage } from "./types";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  mockFetch.mockReset();
  clearTokenCache();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function tokenOk(): Response {
  return new Response(
    JSON.stringify({ accessToken: "test-token", expireIn: 7200 }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function createMockChat(): ChatInstance {
  return {
    getLogger: vi.fn().mockReturnValue(mockLogger),
    getState: vi.fn(),
    getUserName: vi.fn().mockReturnValue("mybot"),
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    processMessage: vi.fn(),
    processReaction: vi.fn(),
    processAction: vi.fn(),
    processModalClose: vi.fn(),
    processModalSubmit: vi.fn().mockResolvedValue(undefined),
    processSlashCommand: vi.fn(),
    processAssistantThreadStarted: vi.fn(),
    processAssistantContextChanged: vi.fn(),
    processAppHomeOpened: vi.fn(),
  } as unknown as ChatInstance;
}

function sampleInboundMessage(
  overrides?: Partial<DingTalkInboundMessage>,
): DingTalkInboundMessage {
  return {
    msgId: "msg-001",
    msgtype: "text",
    createAt: 1735689600000,
    text: { content: "你好" },
    conversationType: "1",
    conversationId: "conv-123",
    senderId: "user-456",
    senderStaffId: "staff-456",
    senderNick: "张三",
    chatbotUserId: "bot-789",
    sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=abc",
    ...overrides,
  };
}

describe("createDingTalkAdapter", () => {
  it("creates an adapter instance", () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    expect(adapter).toBeInstanceOf(DingTalkAdapter);
    expect(adapter.name).toBe("dingtalk");
  });
});

describe("DingTalkAdapter", () => {
  // ─── Thread ID ─────────────────────────────────────────────────

  it("encodes and decodes thread IDs", () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    expect(
      adapter.encodeThreadId({
        conversationId: "user-123",
        conversationType: "1",
      }),
    ).toBe("dingtalk:1:user-123");

    expect(
      adapter.encodeThreadId({
        conversationId: "cidXXXXXX",
        conversationType: "2",
      }),
    ).toBe("dingtalk:2:cidXXXXXX");

    expect(adapter.decodeThreadId("dingtalk:1:user-123")).toEqual({
      conversationId: "user-123",
      conversationType: "1",
    });

    expect(adapter.decodeThreadId("dingtalk:2:cidXXXXXX")).toEqual({
      conversationId: "cidXXXXXX",
      conversationType: "2",
    });
  });

  it("throws on invalid thread ID format", () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    expect(() => adapter.decodeThreadId("invalid")).toThrow(ValidationError);
    expect(() => adapter.decodeThreadId("dingtalk:")).toThrow(ValidationError);
  });

  it("identifies DM threads", () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    expect(adapter.isDM("dingtalk:1:user-123")).toBe(true);
    expect(adapter.isDM("dingtalk:2:cidXXXXXX")).toBe(false);
  });

  // ─── Initialize ────────────────────────────────────────────────

  it("initializes and verifies credentials", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk());

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    expect(adapter.userName).toBe("mybot");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("handles credential verification failure gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    // Should not throw.
    await adapter.initialize(chat);
  });

  // ─── Webhook Handling ──────────────────────────────────────────

  it("handles incoming text message webhook", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk());

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sampleInboundMessage()),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody).toEqual({ msgtype: "empty" });

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, threadId, parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { text: string; isMention?: boolean },
    ];

    expect(threadId).toBe("dingtalk:1:user-456");
    expect(parsedMessage.text).toBe("你好");
    expect(parsedMessage.isMention).toBe(true);
  });

  it("handles group message webhook", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk());

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        sampleInboundMessage({
          conversationType: "2",
          conversationId: "cidGroupXXX",
          conversationTitle: "测试群",
        }),
      ),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    const [, threadId] = processMessage.mock.calls[0] as [unknown, string];
    expect(threadId).toBe("dingtalk:2:cidGroupXXX");
  });

  it("returns 400 for invalid webhook JSON", async () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid-json",
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });

  it("returns 200 when chat is not initialized", async () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sampleInboundMessage()),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("stores bot userId from first message", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk());

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    expect(adapter.botUserId).toBeUndefined();

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sampleInboundMessage()),
    });

    await adapter.handleWebhook(request);
    expect(adapter.botUserId).toBe("bot-789");
  });

  // ─── Card Callback ─────────────────────────────────────────────

  it("handles card callback webhook", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk());

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const callbackPayload = {
      type: "actionCardCallback",
      outTrackId: "card-001",
      userId: "user-456",
      conversationId: "cidGroupXXX",
      conversationType: "2",
      content: encodeDingTalkCallbackData("approve", "req-123"),
    };

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(callbackPayload),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);

    const processAction = chat.processAction as ReturnType<typeof vi.fn>;
    expect(processAction).toHaveBeenCalledTimes(1);

    const [actionEvent] = processAction.mock.calls[0] as [
      { actionId: string; value: string | undefined; messageId: string },
    ];
    expect(actionEvent.actionId).toBe("approve");
    expect(actionEvent.value).toBe("req-123");
    expect(actionEvent.messageId).toBe("card-001");
  });

  // ─── Post Message ──────────────────────────────────────────────

  it("posts message via session webhook", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk()) // initialize
      .mockResolvedValueOnce(tokenOk()) // getAccessToken for post
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 }),
      ); // session webhook

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    // Trigger a webhook to cache the session webhook.
    const webhookReq = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sampleInboundMessage()),
    });
    await adapter.handleWebhook(webhookReq);

    const result = await adapter.postMessage("dingtalk:1:user-456", "回复消息");

    expect(result.threadId).toBe("dingtalk:1:user-456");
    expect(result.raw.text?.content).toBe("回复消息");
  });

  it("posts message via proactive API when no session webhook", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk()) // initialize
      .mockResolvedValueOnce(tokenOk()) // getAccessToken for post (cached)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ processQueryKey: "pqk-001" }), {
          status: 200,
        }),
      ); // proactive API

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const result = await adapter.postMessage(
      "dingtalk:2:cidGroupXXX",
      "主动消息",
    );

    expect(result.id).toBe("pqk-001");
    expect(result.threadId).toBe("dingtalk:2:cidGroupXXX");

    // Verify proactive API was called with correct payload.
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [
      string,
      RequestInit,
    ];
    expect(lastCall[0]).toContain("/v1.0/robot/groupMessages/send");
    const body = JSON.parse(lastCall[1].body as string);
    expect(body.robotCode).toBe("test-id");
    expect(body.openConversationId).toBe("cidGroupXXX");
  });

  it("throws on empty message text", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk());

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    await expect(
      adapter.postMessage("dingtalk:1:user-456", ""),
    ).rejects.toThrow(ValidationError);
  });

  // ─── Edit & Delete ─────────────────────────────────────────────

  it("editMessage posts a new message (DingTalk limitation)", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk()) // initialize
      .mockResolvedValueOnce(tokenOk()) // getAccessToken
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ processQueryKey: "pqk-edit" }), {
          status: 200,
        }),
      );

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const result = await adapter.editMessage(
      "dingtalk:2:cidGroupXXX",
      "old-msg-id",
      "更新的消息",
    );

    expect(result.id).toBe("pqk-edit");
  });

  it("deleteMessage is a no-op (DingTalk limitation)", async () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    // Should not throw.
    await adapter.deleteMessage("dingtalk:1:user-456", "msg-001");
  });

  // ─── Reactions ─────────────────────────────────────────────────

  it("addReaction throws NotImplementedError", async () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    await expect(
      adapter.addReaction("dingtalk:1:user-456", "msg-001", "thumbsup"),
    ).rejects.toThrow("DingTalk does not support reactions");
  });

  it("removeReaction throws NotImplementedError", async () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    await expect(
      adapter.removeReaction("dingtalk:1:user-456", "msg-001", "thumbsup"),
    ).rejects.toThrow("DingTalk does not support reactions");
  });

  // ─── Message Fetching ──────────────────────────────────────────

  it("fetchMessages returns cached messages", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk());

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    // Inject a message via webhook.
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sampleInboundMessage()),
    });
    await adapter.handleWebhook(request);

    const result = await adapter.fetchMessages("dingtalk:1:user-456");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.text).toBe("你好");
  });

  it("fetchMessages returns empty for unknown thread", async () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const result = await adapter.fetchMessages("dingtalk:1:unknown");
    expect(result.messages).toHaveLength(0);
  });

  it("fetchMessage returns cached message by ID", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk());

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sampleInboundMessage()),
    });
    await adapter.handleWebhook(request);

    const message = await adapter.fetchMessage("dingtalk:1:user-456", "msg-001");
    expect(message).not.toBeNull();
    expect(message!.text).toBe("你好");
  });

  it("fetchMessage returns null for unknown message", async () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const message = await adapter.fetchMessage("dingtalk:1:user-456", "unknown");
    expect(message).toBeNull();
  });

  // ─── Thread & Channel Info ─────────────────────────────────────

  it("fetchThread returns thread info", async () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const info = await adapter.fetchThread("dingtalk:1:user-456");
    expect(info.id).toBe("dingtalk:1:user-456");
    expect(info.isDM).toBe(true);
  });

  it("fetchChannelInfo returns channel info", async () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const info = await adapter.fetchChannelInfo("cidGroupXXX");
    expect(info.id).toBe("cidGroupXXX");
    expect(info.isDM).toBe(false);
  });

  // ─── DM Support ────────────────────────────────────────────────

  it("openDM returns DM thread ID", async () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const threadId = await adapter.openDM("user-123");
    expect(threadId).toBe("dingtalk:1:user-123");
  });

  // ─── Message Parsing ──────────────────────────────────────────

  it("parses richText messages", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk());

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        sampleInboundMessage({
          msgtype: "richText",
          text: undefined,
          content: {
            richText: [
              { type: "text", text: "Hello " },
              { type: "text", text: "World" },
            ],
          },
        }),
      ),
    });

    await adapter.handleWebhook(request);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    const [, , parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { text: string },
    ];
    expect(parsedMessage.text).toBe("Hello World");
  });

  it("extracts attachments from picture messages", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk());

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        sampleInboundMessage({
          msgtype: "picture",
          text: undefined,
          content: {
            downloadCode: "dl-code-123",
            fileName: "photo.jpg",
          },
        }),
      ),
    });

    await adapter.handleWebhook(request);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    const [, , parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { attachments: Array<{ type: string; url: string; name: string }> },
    ];
    expect(parsedMessage.attachments).toHaveLength(1);
    expect(parsedMessage.attachments[0]!.type).toBe("image");
    expect(parsedMessage.attachments[0]!.url).toBe("dl-code-123");
  });

  it("extracts audio recognition as text", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk());

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        sampleInboundMessage({
          msgtype: "audio",
          text: undefined,
          content: {
            downloadCode: "dl-audio",
            recognition: "语音识别结果",
          },
        }),
      ),
    });

    await adapter.handleWebhook(request);

    const processMessage = chat.processMessage as ReturnType<typeof vi.fn>;
    const [, , parsedMessage] = processMessage.mock.calls[0] as [
      unknown,
      string,
      { text: string },
    ];
    expect(parsedMessage.text).toBe("语音识别结果");
  });

  // ─── channelIdFromThreadId ─────────────────────────────────────

  it("extracts channel ID from thread ID", () => {
    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    expect(adapter.channelIdFromThreadId("dingtalk:2:cidGroupXXX")).toBe(
      "cidGroupXXX",
    );
    expect(adapter.channelIdFromThreadId("dingtalk:1:user-123")).toBe(
      "user-123",
    );
  });

  // ─── postChannelMessage ────────────────────────────────────────

  it("postChannelMessage delegates to postMessage with group thread", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk()) // initialize
      .mockResolvedValueOnce(tokenOk()) // getAccessToken
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ processQueryKey: "pqk-channel" }), {
          status: 200,
        }),
      );

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const result = await adapter.postChannelMessage("cidGroupXXX", "群消息");

    expect(result.threadId).toBe("dingtalk:2:cidGroupXXX");

    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [
      string,
      RequestInit,
    ];
    expect(lastCall[0]).toContain("/v1.0/robot/groupMessages/send");
  });

  // ─── Proactive DM ──────────────────────────────────────────────

  it("sends proactive DM via oToMessages API", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk()) // initialize
      .mockResolvedValueOnce(tokenOk()) // getAccessToken
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ processQueryKey: "pqk-dm" }), {
          status: 200,
        }),
      );

    const adapter = createDingTalkAdapter({
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    const chat = createMockChat();
    await adapter.initialize(chat);

    const result = await adapter.postMessage("dingtalk:1:user-789", "私聊消息");

    expect(result.threadId).toBe("dingtalk:1:user-789");

    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [
      string,
      RequestInit,
    ];
    expect(lastCall[0]).toContain("/v1.0/robot/oToMessages/batchSend");
    const body = JSON.parse(lastCall[1].body as string);
    expect(body.userIds).toEqual(["user-789"]);
  });
});
