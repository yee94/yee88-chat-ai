# 配置指南

yee88 使用 TOML 格式的配置文件，默认位置为 `~/.yee88/yee88.toml`。

## 完整配置示例

```toml
# 默认引擎
default_engine = "opencode"

# 默认项目（可选）
default_project = "myproject"

# 全局 system prompt（可选）
system_prompt = "You are a helpful AI assistant."

# ─────────────────────────────────────────────────────────────
# Telegram 配置
# ─────────────────────────────────────────────────────────────
[telegram]
# Bot Token (从 @BotFather 获取)
bot_token = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"

# 允许使用 bot 的用户 ID 列表
# 空数组 = 允许所有人
# 获取 user ID: 发送消息给 @userinfobot
allowed_users = [12345678, 87654321]

# ─────────────────────────────────────────────────────────────
# DingTalk 配置
# ─────────────────────────────────────────────────────────────
[dingtalk]
# 应用 AppKey (必填)
client_id = "dingxxxxxxxx"

# 应用 AppSecret (必填)
client_secret = "xxxxxxxxxxxxxxxxxxxxxxxx"

# 机器人编码 (必填)
robot_code = "dingxxxxxxxx"

# 企业 CorpId (可选)
corp_id = "dingxxxxxxxx"

# 应用 AgentId (可选)
agent_id = "123456789"

# 消息交互方式 (可选，默认 "ai_card")
# "ai_card"     - AI Card 流式卡片（打字机效果，仅群聊）
# "recall"      - 撤回重发模式
# "webhook"     - Session Webhook 模式
# "incremental" - 逐条消息发送（每个 action 完成后发送独立消息）
reply_mode = "ai_card"

# 允许使用 bot 的用户 ID 列表
# 空数组 = 允许所有人
# DingTalk 用户 ID 是字符串格式
allowed_users = ["user123", "user456"]

# ─────────────────────────────────────────────────────────────
# 项目配置
# ─────────────────────────────────────────────────────────────
[projects.myproject]
# 项目别名 (用于命令引用)
alias = "myproject"

# 项目路径 (必填)
path = "/home/user/projects/myproject"

# Worktrees 目录 (可选)
worktrees_dir = ".worktrees"

# 绑定到特定 chat ID (可选)
# 该 chat 的消息会自动使用此项目
chat_id = -1001234567890

# 项目级 system prompt (可选，覆盖全局)
system_prompt = "You are working on the myproject codebase."

# 默认引擎 (可选，覆盖全局)
default_engine = "opencode"

[projects.another]
alias = "another"
path = "/home/user/projects/another"
```

## 配置项说明

### 全局配置

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `default_engine` | string | 否 | 默认引擎，目前仅支持 `opencode` |
| `default_project` | string | 否 | 默认项目别名 |
| `system_prompt` | string | 否 | 全局 system prompt |

### Telegram 配置

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `bot_token` | string | 是* | Bot Token，从 @BotFather 获取 |
| `allowed_users` | number[] | 否 | 允许的用户 ID 列表，空数组允许所有人 |

*使用 Telegram 平台时必填

### DingTalk 配置

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `client_id` | string | 是* | 应用 AppKey |
| `client_secret` | string | 是* | 应用 AppSecret |
| `robot_code` | string | 是* | 机器人编码 |
| `corp_id` | string | 否 | 企业 CorpId |
| `agent_id` | string | 否 | 应用 AgentId |
| `reply_mode` | string | 否 | 消息交互方式：`ai_card`(默认)、`recall`、`webhook`、`incremental` |
| `allowed_users` | string[] | 否 | 允许的用户 ID 列表，空数组允许所有人 |

*使用 DingTalk 平台时必填

### 项目配置

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `alias` | string | 否 | 项目别名，默认使用配置 key |
| `path` | string | 是 | 项目绝对路径 |
| `worktrees_dir` | string | 否 | Worktrees 目录，默认 `.worktrees` |
| `chat_id` | number | 否 | 绑定的 chat ID |
| `system_prompt` | string | 否 | 项目级 system prompt |
| `default_engine` | string | 否 | 项目级默认引擎 |

## 配置优先级

1. **Topic 绑定** > **Chat 绑定** > **默认项目**
2. **项目 system_prompt** > **全局 system_prompt**
3. **项目 default_engine** > **全局 default_engine**

## 获取用户 ID

### Telegram

1. 发送任意消息给 [@userinfobot](https://t.me/userinfobot)
2. Bot 会回复你的 user ID

或者查看 bot 日志，未授权用户的 ID 会被记录。

### DingTalk

1. 在钉钉开放平台查看用户的 userId
2. 或者查看 bot 日志中的用户信息

## 环境变量

配置也可以通过环境变量覆盖：

```bash
# 平台选择
export YEE88_PLATFORM=dingtalk  # telegram | dingtalk

# 接入模式
export YEE88_MODE=stream  # webhook | polling | stream

# HTTP 端口
export PORT=3000
```

## 配置文件位置

默认配置文件路径：`~/.yee88/yee88.toml`

可通过命令行参数指定：

```bash
bun run start --config /path/to/config.toml
```

## 状态文件

yee88 会在 `~/.yee88/` 目录下创建以下状态文件：

- `sessions.json` - Session resume token 存储
- `topics.json` - Topic 状态存储

这些文件会自动创建和管理，无需手动配置。