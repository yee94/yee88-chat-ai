# @chat-adapter/dingtalk

DingTalk adapter for [Chat SDK](https://github.com/vercel/chat).

## Installation

```bash
pnpm add @chat-adapter/dingtalk chat
```

## Usage

```typescript
import { Chat } from "chat";
import { createDingTalkAdapter } from "@chat-adapter/dingtalk";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    dingtalk: createDingTalkAdapter(),
  },
});
```

## License

MIT
