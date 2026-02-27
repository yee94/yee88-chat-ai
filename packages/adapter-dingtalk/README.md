# @chat-adapter/dingtalk

DingTalk (钉钉) adapter for [Chat SDK](https://github.com/vercel/chat).

支持 **Webhook 模式** 和 **Stream 模式** 两种接入方式。

## Installation

```bash
pnpm add @chat-adapter/dingtalk chat
```

## Quick Start

### Webhook 模式

```typescript
import { Chat } from "chat";
import { createDingTalkAdapter } from "@chat-adapter/dingtalk";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    dingtalk: createDingTalkAdapter({
      clientId: process.env.DINGTALK_CLIENT_ID!,
      clientSecret: process.env.DINGTALK_CLIENT_SECRET!,
    }),
  },
});

bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post("你好！我正在监听这个会话。");
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`你说了: ${message.text}`);
});
```

### Stream 模式 (推荐)

Stream 模式使用 WebSocket 长连接，**无需公网 IP**，更适合本地开发和内网部署。

```typescript
import { createStreamClient, createDingTalkAdapter } from "@chat-adapter/dingtalk";
import { Chat } from "chat";

// 创建适配器
const adapter = createDingTalkAdapter({
  clientId: process.env.DINGTALK_CLIENT_ID!,
  clientSecret: process.env.DINGTALK_CLIENT_SECRET!,
});

// 创建 Stream 客户端
const stream = createStreamClient({
  clientId: process.env.DINGTALK_CLIENT_ID!,
  clientSecret: process.env.DINGTALK_CLIENT_SECRET!,
  debug: true,
});

// 创建 Chat 实例
const bot = new Chat({
  userName: "mybot",
  adapters: { dingtalk: adapter },
});

// 监听 Stream 消息并转发给适配器
stream.onMessage(async (message, ack) => {
  // 解析并处理消息
  const parsed = adapter.parseMessage(message);
  console.log("收到消息:", parsed.text);
  
  // 确认消息
  ack();
});

// 连接 Stream
await stream.connect();
console.log("DingTalk Stream 已连接");
```

## Configuration

| Option         | Type     | Required | Description                                          |
| -------------- | -------- | -------- | ---------------------------------------------------- |
| `clientId`     | `string` | ✅       | DingTalk 应用 AppKey                                  |
| `clientSecret` | `string` | ✅       | DingTalk 应用 AppSecret                               |
| `robotCode`    | `string` | ❌       | 机器人编码 (默认使用 clientId)                          |
| `corpId`       | `string` | ❌       | 企业 CorpId                                           |
| `agentId`      | `string` | ❌       | 应用 AgentId                                          |
| `apiBaseUrl`   | `string` | ❌       | 自定义 API 地址 (默认 `https://api.dingtalk.com`)      |

### AI Card Streaming 配置 (可选)

配置后启用 AI 卡片流式输出，实现打字机效果的流式响应体验。

| Option            | Type     | Required | Default     | Description                                                    |
| ----------------- | -------- | -------- | ----------- | -------------------------------------------------------------- |
| `cardTemplateId`  | `string` | ❌       | -           | AI 卡片模板 ID，在[钉钉开放平台](https://open.dingtalk.com/)创建 |
| `cardTemplateKey` | `string` | ❌       | `"content"` | 卡片模板中用于内容的变量 key                                     |

配置 `cardTemplateId` 后，适配器会自动使用 AI Card 实现流式响应，提供打字机效果的最佳用户体验。

### Stream 模式额外配置

| Option                  | Type      | Default | Description                    |
| ----------------------- | --------- | ------- | ------------------------------ |
| `debug`                 | `boolean` | `false` | 启用调试日志                     |
| `autoReconnect`         | `boolean` | `true`  | 断开后自动重连                   |
| `maxReconnectAttempts`  | `number`  | `10`    | 最大重连次数                     |
| `initialReconnectDelay` | `number`  | `1000`  | 初始重连延迟 (ms)                |
| `maxReconnectDelay`     | `number`  | `30000` | 最大重连延迟 (ms)                |

## Capability Matrix

与 Chat SDK 其他适配器的能力对比:

| Feature                | Slack | Teams | Google Chat | Discord | Telegram | **DingTalk** |
| ---------------------- | ----- | ----- | ----------- | ------- | -------- | ------------ |
| Mentions               | ✅    | ✅    | ✅          | ✅      | ✅       | ✅           |
| Post Messages          | ✅    | ✅    | ✅          | ✅      | ✅       | ✅           |
| Edit Messages          | ✅    | ✅    | ✅          | ✅      | ✅       | ⚠️ New msg   |
| Delete Messages        | ✅    | ✅    | ✅          | ✅      | ✅       | ❌           |
| Reactions              | ✅    | 🔍    | ✅          | ✅      | ✅       | ❌           |
| Cards / ActionCards    | ✅    | ✅    | ✅          | ✅      | Partial  | ✅           |
| Modals                 | ✅    | ❌    | ❌          | ❌      | ❌       | ❌           |
| AI Streaming           | ✅    | ⚠️    | ⚠️          | ⚠️      | ⚠️       | ✅ AI Card   |
| DMs                    | ✅    | ✅    | ✅          | ✅      | ✅       | ✅           |
| Group Chat             | ✅    | ✅    | ✅          | ✅      | ✅       | ✅           |
| File Uploads           | ✅    | ✅    | ✅          | ✅      | ✅       | 🔍 Receive   |
| Ephemeral Messages     | ✅    | ❌    | ❌          | ❌      | ❌       | ❌           |
| Slash Commands         | ✅    | ✅    | ✅          | ✅      | ✅       | ❌           |
| Typing Indicator       | ✅    | ✅    | ✅          | ✅      | ✅       | ❌           |
| Message History        | ✅    | ✅    | ✅          | ✅      | Cache    | Cache        |
| **Stream Mode**        | ❌    | ❌    | ❌          | ❌      | ❌       | ✅           |

**Legend:**
- ✅ Fully supported
- ⚠️ Partial / workaround
- 🔍 Read-only / receive-only
- ❌ Not supported by platform

## DingTalk-Specific Features

### Stream 模式 vs Webhook 模式

| 特性           | Stream 模式        | Webhook 模式       |
| -------------- | ------------------ | ------------------ |
| 公网 IP        | ❌ 不需要          | ✅ 需要            |
| 本地开发       | ✅ 直接可用        | ⚠️ 需要内网穿透    |
| 连接方式       | WebSocket 长连接   | HTTP POST 回调     |
| 消息延迟       | 更低               | 略高               |
| 稳定性         | 自动重连           | 依赖服务器可用性   |

### Session Webhook Reply

当收到消息时，DingTalk 提供一个临时的 `sessionWebhook` URL，适配器会优先使用它来回复消息（更快、无需额外鉴权）。当 session webhook 不可用时，自动降级到主动消息 API。

### Proactive Messages (主动消息)

通过 `openDM()` 和 `postMessage()` 可以向用户或群组发送主动消息：

```typescript
// 发送私聊消息
const dmThread = await adapter.openDM("userId");
await adapter.postMessage(dmThread, "Hello!");

// 发送群消息
const groupThread = adapter.encodeThreadId({
  conversationId: "cidXXXXXX",
  conversationType: "2",
});
await adapter.postMessage(groupThread, "群消息");
```

### AI Card Streaming (AI 卡片流式输出)

配置 `cardTemplateId` 后，适配器会使用钉钉 AI 卡片实现流式响应，带来打字机效果的实时输出体验。

**消息发送/编辑策略优先级：**

1. **AI Card Streaming** (需配置 `cardTemplateId`) — 最佳体验，实时流式更新
2. **Proactive API + Recall** (需 `staffId` 和 IP 白名单) — 撤回旧消息并重发
3. **Session Webhook** (兜底) — 发送新消息，无法撤回

```typescript
import { createDingTalkAdapter } from "@chat-adapter/dingtalk";

const adapter = createDingTalkAdapter({
  clientId: process.env.DINGTALK_CLIENT_ID!,
  clientSecret: process.env.DINGTALK_CLIENT_SECRET!,
  // 启用 AI Card Streaming
  cardTemplateId: "your-card-template-id.schema",
  cardTemplateKey: "content", // 默认值，可省略
});

// 流式响应示例
const rawMsg = await adapter.postMessage(threadId, "正在思考...");
// rawMsg.id 格式为 "aicard:{cardInstanceId}"

// 更新内容（流式效果）
await adapter.editMessage(threadId, rawMsg.id, "正在思考...\n\n第一段内容");
await adapter.editMessage(threadId, rawMsg.id, "正在思考...\n\n第一段内容\n\n第二段内容");

// 完成流式输出
await adapter.finalizeMessage(threadId, rawMsg.id, "最终完整内容");
```

**创建 AI 卡片模板：**

1. 登录 [钉钉开放平台](https://open.dingtalk.com/)
2. 进入应用 → 卡片模板 → 创建模板
3. 选择 "AI 卡片" 类型
4. 添加一个 Markdown 类型的变量（默认 key 为 `content`）
5. 保存并获取模板 ID（格式如 `xxxxx.schema`）

### ActionCard (交互卡片)

Chat SDK 的 Card 元素会自动转换为 DingTalk ActionCard 格式：

```tsx
import { Card, Section, Actions, Button, LinkButton } from "chat";

await thread.post(
  <Card>
    <Section>请选择操作:</Section>
    <Actions>
      <Button id="approve" value="yes">同意</Button>
      <Button id="reject" value="no">拒绝</Button>
      <LinkButton url="https://example.com">查看详情</LinkButton>
    </Actions>
  </Card>
);
```

### Media Attachments (附件接收)

适配器支持接收以下类型的媒体附件：
- 图片 (`picture`)
- 视频 (`video`)
- 音频 (`audio`)
- 文件 (`file`)
- 富文本中的图片 (`richText`)

附件通过 `downloadCode` 标识，可通过 DingTalk API 下载。

### Thread ID Format

DingTalk 的 thread ID 格式为: `dingtalk:{conversationType}:{conversationId}`

- 单聊: `dingtalk:1:{userId}`
- 群聊: `dingtalk:2:{conversationId}`

## Stream Client API

```typescript
import { createStreamClient, TOPIC_ROBOT, TOPIC_CARD } from "@chat-adapter/dingtalk";

const stream = createStreamClient({
  clientId: "your-client-id",
  clientSecret: "your-client-secret",
  debug: true,
  autoReconnect: true,
});

// 监听连接状态变化
stream.onStateChange((state, error) => {
  console.log("Stream state:", state, error);
});

// 监听机器人消息
stream.onMessage((message, ack) => {
  console.log("Message:", message.text?.content);
  ack(); // 确认消息
});

// 监听所有原始消息 (包括卡片回调等)
stream.onRawMessage((msg) => {
  console.log("Raw message:", msg.headers.topic, msg.data);
});

// 连接
await stream.connect();

// 获取状态
console.log("State:", stream.getState()); // "connected"

// 断开连接
await stream.disconnect();
```

## Authentication

适配器使用 OAuth2 Client Credentials 方式获取 access token，内置：
- 按 `clientId` 隔离的 token 缓存
- 过期前 60 秒自动刷新
- 失败自动重试 (最多 3 次，指数退避)

## Setup Guide

### 1. 创建企业内部应用

1. 登录 [钉钉开放平台](https://open.dingtalk.com/)
2. 创建企业内部应用，获取 `ClientID` (AppKey) 和 `ClientSecret` (AppSecret)

### 2. 配置机器人

1. 进入应用 → 应用能力 → 添加应用能力 → 机器人
2. 完善机器人信息
3. **选择消息接收模式**:
   - **Stream 模式** (推荐): 无需公网 IP
   - **Webhook 模式**: 需要配置回调地址

### 3. 发布应用

配置完成后发布应用，即可在钉钉中使用机器人。

## License

MIT
