# @chat-adapter/dingtalk

DingTalk (钉钉) adapter for [Chat SDK](https://github.com/vercel/chat).

## Installation

```bash
pnpm add @chat-adapter/dingtalk chat
```

## Quick Start

```typescript
import { Chat } from "chat";
import { createDingTalkAdapter } from "@chat-adapter/dingtalk";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    dingtalk: createDingTalkAdapter({
      clientId: process.env.DINGTALK_CLIENT_ID!,
      clientSecret: process.env.DINGTALK_CLIENT_SECRET!,
      robotCode: process.env.DINGTALK_ROBOT_CODE, // optional, defaults to clientId
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

## Configuration

| Option         | Type     | Required | Description                                          |
| -------------- | -------- | -------- | ---------------------------------------------------- |
| `clientId`     | `string` | ✅       | DingTalk 应用 AppKey                                  |
| `clientSecret` | `string` | ✅       | DingTalk 应用 AppSecret                               |
| `robotCode`    | `string` | ❌       | 机器人编码 (默认使用 clientId)                          |
| `corpId`       | `string` | ❌       | 企业 CorpId                                           |
| `agentId`      | `string` | ❌       | 应用 AgentId                                          |
| `apiBaseUrl`   | `string` | ❌       | 自定义 API 地址 (默认 `https://api.dingtalk.com`)      |

## Capability Matrix

与 Chat SDK 其他适配器的能力对比:

| Feature                | Slack | Teams | Google Chat | Discord | Telegram | **DingTalk** |
| ---------------------- | ----- | ----- | ----------- | ------- | -------- | ------------ |
| Mentions               | ✅    | ✅    | ✅          | ✅      | ✅       | ✅           |
| Post Messages          | ✅    | ✅    | ✅          | ✅      | ✅       | ✅           |
| Edit Messages          | ✅    | ✅    | ✅          | ✅      | ✅       | ⚠️ New msg   |
| Delete Messages        | ✅    | ✅    | ✅          | ✅      | ✅       | ❌           |
| Reactions              | ✅    | 🔍    | ✅          | ✅      | ✅       | ❌           |
| Cards / ActionCards     | ✅    | ✅    | ✅          | ✅      | Partial  | ✅           |
| Modals                 | ✅    | ❌    | ❌          | ❌      | ❌       | ❌           |
| AI Streaming           | ✅    | ⚠️    | ⚠️          | ⚠️      | ⚠️       | ⚠️ Post+Edit |
| DMs                    | ✅    | ✅    | ✅          | ✅      | ✅       | ✅           |
| Group Chat             | ✅    | ✅    | ✅          | ✅      | ✅       | ✅           |
| File Uploads           | ✅    | ✅    | ✅          | ✅      | ✅       | 🔍 Receive   |
| Ephemeral Messages     | ✅    | ❌    | ❌          | ❌      | ❌       | ❌           |
| Slash Commands         | ✅    | ✅    | ✅          | ✅      | ✅       | ❌           |
| Typing Indicator       | ✅    | ✅    | ✅          | ✅      | ✅       | ❌           |
| Message History Fetch  | ✅    | ✅    | ✅          | ✅      | Cache    | Cache        |
| Thread Info             | ✅    | ✅    | ✅          | ✅      | ✅       | ✅           |
| Channel Info            | ✅    | ✅    | ✅          | ✅      | ✅       | ✅ Basic     |

**Legend:**
- ✅ Fully supported
- ⚠️ Partial / workaround
- 🔍 Read-only / receive-only
- ❌ Not supported by platform

## DingTalk-Specific Features

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

### ActionCard (交互卡片)

Chat SDK 的 Card 元素会自动转换为 DingTalk ActionCard 格式：

```typescript
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

## Authentication

适配器使用 OAuth2 Client Credentials 方式获取 access token，内置：
- 按 `clientId` 隔离的 token 缓存
- 过期前 60 秒自动刷新
- 失败自动重试 (最多 3 次，指数退避)

## Webhook Setup

在钉钉开放平台配置机器人回调地址，指向你的服务器：

```
POST https://your-server.com/webhook/dingtalk
```

Chat SDK 会自动路由到 DingTalk 适配器的 `handleWebhook` 方法。

## License

MIT
