# yee88

Telegram / DingTalk Bot 桥接 OpenCode CLI 的 AI 编程助手。

## 特性

- 🤖 **多平台支持**: Telegram 和 DingTalk 双平台
- 🔄 **多种接入模式**: Webhook、Polling (Telegram)、Stream (DingTalk)
- 💬 **会话管理**: Session 持久化，支持上下文续接
- 📁 **项目绑定**: Topic/群组可绑定特定项目
- 🔐 **权限控制**: 基于用户 ID 的访问控制
- ⚡ **实时反馈**: 流式输出 + 进度更新

## 快速开始

### 安装

```bash
pnpm install
```

### 配置

创建配置文件 `~/.yee88/yee88.toml`:

```toml
default_engine = "opencode"
default_project = "myproject"

[telegram]
bot_token = "123456:ABC-DEF..."
allowed_users = [12345678]  # 空数组允许所有人

[dingtalk]
client_id = "your_app_key"
client_secret = "your_app_secret"
robot_code = "your_robot_code"
allowed_users = []  # 空数组允许所有人

[projects.myproject]
alias = "myproject"
path = "/path/to/your/project"
```

### 运行

```bash
# Telegram (默认 polling 模式)
cd packages/yee88
bun run start

# DingTalk (默认 stream 模式)
YEE88_PLATFORM=dingtalk bun run start

# 指定模式
YEE88_PLATFORM=telegram YEE88_MODE=webhook bun run start
YEE88_PLATFORM=dingtalk YEE88_MODE=stream bun run start
```

## 项目结构

```
packages/
├── yee88/                    # 主应用 - Bot 服务
│   └── src/
│       ├── chat/             # Bot 核心逻辑
│       │   ├── bot.ts        # Telegram Bot
│       │   ├── bot-dingtalk.ts  # DingTalk Bot
│       │   ├── bot-core.ts   # 共享核心逻辑
│       │   └── server.ts     # HTTP 服务器
│       ├── config/           # 配置管理
│       ├── runner/           # OpenCode CLI 运行器
│       ├── session/          # Session 持久化
│       └── topic/            # Topic 状态管理
│
└── adapter-dingtalk/         # DingTalk 适配器
    └── src/
        ├── index.ts          # 适配器主入口
        ├── stream.ts         # Stream 模式客户端
        ├── auth.ts           # 鉴权
        └── cards.ts          # ActionCard 支持
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `YEE88_PLATFORM` | 平台选择 (`telegram` / `dingtalk`) | `telegram` |
| `YEE88_MODE` | 接入模式 (`webhook` / `polling` / `stream`) | 平台默认 |
| `PORT` | HTTP 服务端口 | `3000` |

## 开发

```bash
# 开发模式 (热重载)
bun run dev

# 类型检查
bun run typecheck

# 运行测试
bun test
```

## 文档

- [yee88 Bot 详细文档](./packages/yee88/README.md)
- [DingTalk 适配器文档](./packages/adapter-dingtalk/README.md)
- [配置指南](./docs/configuration.md)
- [部署指南](./docs/deployment.md)

## License

MIT