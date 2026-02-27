# Plan: `/model` 命令支持

## 背景

takopi（Python 版）已实现完整的 `/model` 命令体系（383 行），支持针对当前对话切换模型。
yee88-chat-ai（TypeScript 版）**完全没有斜杠命令处理逻辑**，所有消息直接发给 runner。

## 目标

在 yee88-chat-ai 中实现 `/model` 命令，支持针对当前对话（topic/chat 级别）切换模型。

---

## 现状分析

### 已有基础设施（可复用）

| 模块 | 现状 | 备注 |
|------|------|------|
| `TopicStateStore` | ✅ 已有 `defaultEngine` 字段 | 但没有 model override 字段 |
| `RunOptions.model` | ✅ 接口已定义 | `runner/types.ts:6` |
| `OpenCodeRunner.buildArgs` | ✅ 支持 `--model` 参数 | `opencode.ts:326-329` |
| `BotThreadState.engineOverride` | ⚠️ 字段存在但未使用 | `bot.ts:19` |

### 缺失部分

| 缺失 | 说明 |
|------|------|
| 命令路由层 | `handleMessage` 中无 `/` 前缀判断 |
| `/model` 命令处理器 | 不存在 |
| Model override 存储 | `ThreadState` 无 `modelOverride` 字段 |
| Override → Runner 传递 | `bot.ts` 中 `runner.run()` 未传 model |

---

## 实现方案

### Phase 1: 命令路由框架

**文件：`src/chat/commands.ts`（新建）**

```typescript
interface CommandResult {
  handled: boolean;
  reply?: string;
}

type CommandHandler = (args: string, ctx: CommandContext) => Promise<CommandResult>;

// 解析 "/model set xxx" → { command: "model", args: "set xxx" }
function parseSlashCommand(text: string): { command: string; args: string } | null;
```

**修改：`src/chat/bot.ts`**

在 `handleMessage` 开头增加命令拦截：

```typescript
if (text.startsWith("/")) {
  const result = await handleSlashCommand(text, commandContext);
  if (result.handled) {
    if (result.reply) await thread.post({ markdown: result.reply });
    return;
  }
}
```

### Phase 2: Model Override 存储

**修改：`src/topic/state.ts`**

`ThreadState` 增加字段：

```typescript
interface ThreadState {
  // ... 现有字段
  modelOverride: string | null;  // 新增：模型覆盖
}
```

`TopicStateStore` 增加方法：

```typescript
getModelOverride(chatId, threadId): string | null;
setModelOverride(chatId, threadId, model: string | null): void;
```

### Phase 3: `/model` 命令处理器

**文件：`src/chat/commands/model.ts`（新建）**

支持的子命令（参考 takopi，简化版）：

| 子命令 | 功能 | 优先级 |
|--------|------|--------|
| `/model` | 显示当前模型状态 + 可用模型列表 | P0 |
| `/model status` | 同上 | P0 |
| `/model set <model>` | 设置当前 topic/chat 的模型 override | P0 |
| `/model clear` | 清除模型 override，回退默认 | P0 |
| `/model list` | 调用 `opencode models` 列出可用模型 | P1 |

实现逻辑：

```typescript
async function handleModelCommand(args: string, ctx: CommandContext): Promise<CommandResult> {
  const tokens = args.trim().split(/\s+/);
  const action = tokens[0]?.toLowerCase() ?? "";

  switch (action) {
    case "":
    case "status":
      // 读取 topicStore.getModelOverride() 并回复
      break;
    case "set":
      // topicStore.setModelOverride(chatId, threadId, tokens[1])
      break;
    case "clear":
      // topicStore.setModelOverride(chatId, threadId, null)
      break;
    case "list":
      // Bun.spawn(["opencode", "models"]) 获取列表
      break;
  }
}
```

### Phase 4: Runner 集成

**修改：`src/chat/bot.ts`**

在 `runner.run()` 调用前，读取 model override 并传入：

```typescript
// 现有代码
let cwd: string | undefined;
// ...

// 新增：读取 model override
let model: string | undefined;
if (topicThreadId) {
  model = topicStore.getModelOverride(chatId, topicThreadId) ?? undefined;
}

// 传递给 runner
for await (const event of runner.run(text, resume, { cwd, model })) {
```

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/chat/commands.ts` | **新建** | 命令路由框架 + parseSlashCommand |
| `src/chat/commands/model.ts` | **新建** | `/model` 命令处理器 |
| `src/chat/bot.ts` | **修改** | 增加命令拦截 + model override 传递 |
| `src/topic/state.ts` | **修改** | 增加 modelOverride 字段和方法 |
| `src/__tests__/model-command.test.ts` | **新建** | `/model` 命令单元测试 |
| `src/__tests__/topic-state.test.ts` | **修改** | 增加 modelOverride 测试 |

## 与 takopi 的差异（有意简化）

| takopi 功能 | yee88 方案 | 原因 |
|-------------|-----------|------|
| 多引擎支持（engine 参数） | 仅 opencode | yee88 当前只有一个引擎 |
| chat_prefs 独立存储 | 复用 TopicStateStore | 架构更简单 |
| admin 权限验证 | 复用现有 `isAuthorized` | 已有 allowed_users 机制 |
| inline keyboard 选择 | `/model list` 文本列表 | chat SDK 暂不支持 inline keyboard |
| reasoning override | 不实现 | 后续按需加 |
| `/model set <engine> <model>` | 不实现 | 单引擎不需要 |

## 依赖关系

```
Phase 1 (命令路由) ← Phase 3 (model 处理器)
Phase 2 (存储)     ← Phase 3 (model 处理器)
Phase 4 (Runner 集成) ← Phase 2 (存储)
```

Phase 1 和 Phase 2 可并行开发。

## 验证方式

1. `bun run typecheck` — 类型检查通过
2. `bun test` — 所有测试通过（含新增测试）
3. 手动测试：发送 `/model status`、`/model set claude-sonnet-4-20250514`、`/model clear`