# yee88

Telegram / DingTalk Bot 桥接 OpenCode CLI 的 AI 编程助手。

## 功能

- 🤖 **多平台**: 支持 Telegram 和 DingTalk
- 💬 **会话续接**: Session 持久化，支持上下文续接
- 📁 **项目绑定**: Topic/群组可绑定特定项目和分支
- 🔐 **权限控制**: 基于用户 ID 的访问控制
- ⚡ **实时反馈**: 流式输出 + 进度更新
- 🔄 **多模式**: Webhook、Polling、Stream 模式

## 安装

```bash
pnpm install
```

## 配置

配置文件位于 `~/.yee88/yee88.toml`:

```toml
default_engine = "opencode"
default_project = "myproject"
system_prompt = "You are a helpful assistant."  # 可选

# Telegram 配置
[telegram]
bot_token = "123456:ABC-DEF..."
allowed_users = [12345678]  # 空数组允许所有人

# DingTalk 配置
[dingtalk]
client_id = "your_app_key"
client_secret = "your_app_secret"
robot_code = "your_robot_code"  # 必填
corp_id = "your_corp_id"        # 可选
agent_id = "your_agent_id"      # 可选
allowed_users = []              # 空数组允许所有人

# 项目配置
[projects.myproject]
alias = "myproject"
path = "/path/to/your/project"
worktrees_dir = ".worktrees"    # 可选
chat_id = 12345678              # 可选，绑定到特定 chat
system_prompt = "Project specific prompt"  # 可选
```

## 运行

### Telegram

```bash
# Polling 模式 (默认，无需公网 IP)
bun run start

# Webhook 模式 (需要公网 IP)
YEE88_MODE=webhook bun run start
```

### DingTalk

```bash
# Stream 模式 (默认，无需公网 IP)
YEE88_PLATFORM=dingtalk bun run start

# Webhook 模式 (需要公网 IP)
YEE88_PLATFORM=dingtalk YEE88_MODE=webhook bun run start
```

### 开发模式

```bash
bun run dev  # 热重载
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `YEE88_PLATFORM` | 平台 (`telegram` / `dingtalk`) | `telegram` |
| `YEE88_MODE` | 模式 (`webhook` / `polling` / `stream`) | 平台默认 |
| `PORT` | HTTP 端口 | `3000` |

## 项目结构

```
src/
├── index.ts              # 主入口
├── model.ts              # 核心领域模型
├── chat/
│   ├── server.ts         # HTTP 服务器 (多平台多模式)
│   ├── bot.ts            # Telegram Bot
│   ├── bot-dingtalk.ts   # DingTalk Bot
│   ├── bot-core.ts       # 共享核心逻辑
│   ├── guard.ts          # 权限验证
│   ├── polling.ts        # Telegram Polling
│   ├── startup.ts        # 启动消息
│   └── state.ts          # 内存 StateAdapter
├── config/
│   └── index.ts          # TOML 配置管理
├── runner/
│   ├── types.ts          # Runner 接口
│   └── opencode.ts       # OpenCode CLI Runner
├── schema/
│   └── opencode.ts       # OpenCode 事件 Schema
├── session/
│   ├── store.ts          # Session 持久化
│   └── lock.ts           # 异步互斥锁
├── topic/
│   ├── state.ts          # Topic 状态管理
│   └── context.ts        # Topic 上下文
├── scheduler/
│   └── index.ts          # 任务调度器
├── markdown/
│   └── index.ts          # Markdown 渲染
└── cli/
    ├── index.ts          # CLI 入口
    └── onboard.ts        # 交互式配置
```

## CLI 命令

```bash
# 交互式配置
bun run cli onboard

# 其他命令 (待实现)
bun run cli project add <alias> <path>
bun run cli project list
```

## 测试

```bash
bun test                              # 运行所有测试
bun test --filter "guard"             # 按名称过滤
bun test src/__tests__/guard.test.ts  # 单个文件
```

## 架构说明

### 多平台支持

Bot 核心逻辑抽取到 `bot-core.ts`，平台特定代码在 `bot.ts` (Telegram) 和 `bot-dingtalk.ts` (DingTalk)。

```
┌─────────────────┐     ┌─────────────────┐
│  bot.ts         │     │  bot-dingtalk.ts│
│  (Telegram)     │     │  (DingTalk)     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │ bot-core.ts │
              │ (共享逻辑)   │
              └──────┬──────┘
                     │
              ┌──────▼──────┐
              │ OpenCode    │
              │ Runner      │
              └─────────────┘
```

### Session 隔离

- **Topic 级别**: 同一 chat 的不同 topic 有独立 session
- **Chat 级别**: 无 topic 时使用 chat 级别 session
- **持久化**: JSON 文件存储在 `~/.yee88/`

### 消息处理流程

```
1. 收到消息 (Webhook/Polling/Stream)
2. 权限验证 (guard.ts)
3. 解析 Topic 上下文
4. 获取/创建 Session
5. 调用 OpenCode Runner
6. 流式输出 + 进度更新
7. 保存 Session
```

## 平台对比

| 特性 | Telegram | DingTalk |
|------|----------|----------|
| Polling 模式 | ✅ | ❌ |
| Stream 模式 | ❌ | ✅ |
| Webhook 模式 | ✅ | ✅ |
| 消息编辑 | ✅ | ⚠️ 新消息 |
| Topic 支持 | ✅ | ✅ |
| 文件上传 | ✅ | 🔍 接收 |
| ActionCard | Partial | ✅ |

## License

MIT