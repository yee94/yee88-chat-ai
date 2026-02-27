/**
 * DingTalk adapter types for Chat SDK.
 *
 * @see https://open.dingtalk.com/document/orgapp/robot-overview
 */

/**
 * DingTalk adapter configuration.
 */
export interface DingTalkAdapterConfig {
  /** DingTalk application AppKey (also used as clientId). */
  clientId: string;
  /** DingTalk application AppSecret. */
  clientSecret: string;
  /** Robot code (defaults to clientId if not set). */
  robotCode?: string;
  /** Enterprise CorpId. */
  corpId?: string;
  /** Application AgentId. */
  agentId?: string;
  /** Optional custom API base URL (defaults to https://api.dingtalk.com). */
  apiBaseUrl?: string;

  // ─── AI Card Streaming (Optional) ────────────────────────────────
  /**
   * AI Card template ID for streaming responses.
   * If configured, enables true streaming with typewriter effect.
   * Create template at: https://open.dingtalk.com/
   */
  cardTemplateId?: string;
  /**
   * AI Card template variable key for content (default: "content").
   */
  cardTemplateKey?: string;
}

/**
 * DingTalk thread ID components.
 */
export interface DingTalkThreadId {
  /** Conversation ID (openConversationId for groups, conversationId for DMs). */
  conversationId: string;
  /** Conversation type: "1" = DM, "2" = group chat. */
  conversationType: "1" | "2";
  /** Staff ID for DM proactive messages (only available for enterprise internal users). */
  staffId?: string;
}

/**
 * DingTalk user object from inbound message.
 * @see https://open.dingtalk.com/document/orgapp/receive-message
 */
export interface DingTalkUser {
  /** Sender's open userId. */
  senderId: string;
  /** Sender's staffId (enterprise internal). */
  senderStaffId?: string;
  /** Sender's display name. */
  senderNick?: string;
}

/**
 * DingTalk inbound message (webhook payload from robot callback).
 * @see https://open.dingtalk.com/document/orgapp/receive-message
 */
export interface DingTalkInboundMessage {
  /** Message ID. */
  msgId: string;
  /** Message type: text, richText, picture, video, audio, file. */
  msgtype: string;
  /** Message creation timestamp (ms). */
  createAt: number;
  /** Text message content. */
  text?: {
    content: string;
  };
  /** Rich content (for picture, video, audio, file, richText). */
  content?: {
    downloadCode?: string;
    fileName?: string;
    recognition?: string;
    richText?: Array<{
      type: string;
      text?: string;
      atName?: string;
      downloadCode?: string;
    }>;
  };
  /** Conversation type: "1" = DM, "2" = group chat. */
  conversationType: string;
  /** Conversation ID. */
  conversationId: string;
  /** Group chat title (only for group chats). */
  conversationTitle?: string;
  /** Sender's open userId. */
  senderId: string;
  /** Sender's staffId. */
  senderStaffId?: string;
  /** Sender's display name. */
  senderNick?: string;
  /** Bot's userId. */
  chatbotUserId: string;
  /** Session webhook URL for replying within the session. */
  sessionWebhook: string;
  /** Whether the bot is in @all list. */
  isInAtList?: boolean;
  /** List of @'d users. */
  atUsers?: Array<{
    dingtalkId: string;
    staffId?: string;
  }>;
}

/**
 * DingTalk interactive card callback payload.
 * @see https://open.dingtalk.com/document/orgapp/interactive-card-callback
 */
export interface DingTalkCardCallback {
  /** Callback type. */
  type: string;
  /** Card instance ID. */
  outTrackId: string;
  /** User who clicked. */
  userId: string;
  /** Conversation ID. */
  conversationId?: string;
  /** Conversation type. */
  conversationType?: string;
  /** Callback content (JSON string with action data). */
  content?: string;
}

/**
 * DingTalk session webhook response payload.
 */
export interface DingTalkSessionResponse {
  msgtype: "text" | "markdown" | "actionCard" | "empty";
  text?: {
    content: string;
  };
  markdown?: {
    title: string;
    text: string;
  };
  actionCard?: {
    title: string;
    text: string;
    btnOrientation?: "0" | "1";
    btns?: Array<{
      title: string;
      actionURL: string;
    }>;
    singleTitle?: string;
    singleURL?: string;
  };
  at?: {
    atUserIds?: string[];
    isAtAll?: boolean;
  };
}

/**
 * DingTalk proactive message payload.
 * @see https://open.dingtalk.com/document/orgapp/robot-send-group-messages
 */
export interface DingTalkProactivePayload {
  robotCode: string;
  msgKey: string;
  msgParam: string;
  openConversationId?: string;
  userIds?: string[];
}

/**
 * DingTalk API token response.
 */
export interface DingTalkTokenResponse {
  accessToken: string;
  expireIn: number;
}

/**
 * DingTalk API generic response wrapper.
 */
export interface DingTalkApiResponse<T = unknown> {
  data?: T;
  code?: string;
  message?: string;
  success?: boolean;
}

/**
 * Raw message type for the adapter generic parameter.
 */
export type DingTalkRawMessage = DingTalkInboundMessage;
