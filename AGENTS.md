# AGENTS.md — yee88

Telegram / DingTalk Bot 桥接 OpenCode CLI 的 AI 编程助手。Bun + TypeScript monorepo 项目。

## Build & Run

```bash
bun install              # 安装依赖
bun run dev              # 开发模式（--hot）
bun run start            # 生产模式
bun run cli              # CLI 入口 (src/cli/index.ts)
bun run typecheck        # tsc --noEmit 类型检查
```

## Testing

使用 `bun:test`，测试文件位于 `src/__tests__/*.test.ts`。

```bash
bun test                              # 运行所有测试
bun test --filter "guard"             # 按名称过滤（匹配 describe/test 名称）
bun test src/__tests__/guard.test.ts  # 运行单个测试文件
```

测试文件命名：`src/__tests__/<module>.test.ts`，与被测模块同名。

## Project Structure

```
packages/
├── yee88/                    # 主应用 - Bot 服务
│   └── src/
│       ├── index.ts          # 主入口，调用 startServer()
│       ├── model.ts          # 核心领域模型（Event, Action, ResumeToken）
│       ├── chat/
│       │   ├── server.ts     # Bun.serve 多平台服务器
│       │   ├── bot.ts        # Telegram Bot
│       │   ├── bot-dingtalk.ts  # DingTalk Bot
│       │   ├── bot-core.ts   # 共享核心逻辑（adapter 无关）
│       │   ├── guard.ts      # 权限验证（Telegram + DingTalk）
│       │   ├── polling.ts    # Telegram Polling 客户端
│       │   ├── startup.ts    # 启动消息生成
│       │   └── state.ts      # 内存版 StateAdapter
│       ├── config/index.ts   # TOML 配置管理（Zod schema）
│       ├── runner/
│       │   ├── types.ts      # Runner 接口定义
│       │   └── opencode.ts   # OpenCode CLI Runner（JSONL 流解析）
│       ├── schema/opencode.ts # OpenCode 事件 Zod schema
│       ├── session/
│       │   ├── store.ts      # Session resume token 持久化
│       │   └── lock.ts       # 异步互斥锁
│       ├── topic/
│       │   ├── state.ts      # Topic 级别状态管理
│       │   └── context.ts    # Topic 上下文合并
│       ├── scheduler/index.ts # 线程任务调度器
│       ├── markdown/index.ts  # Markdown 渲染、消息分割
│       ├── cli/
│       │   ├── index.ts      # CLI 子命令路由
│       │   └── onboard.ts    # 交互式 onboarding
│       └── __tests__/        # 所有测试文件
│
└── adapter-dingtalk/         # DingTalk 适配器
    └── src/
        ├── index.ts          # 适配器主入口
        ├── stream.ts         # Stream 模式客户端
        ├── auth.ts           # 鉴权
        ├── cards.ts          # ActionCard 支持
        ├── markdown.ts       # Markdown 转换
        └── types.ts          # 类型定义
```

## Runtime & Tooling

- **Runtime:** Bun（不要用 Node.js / npm / pnpm）
- **语言:** TypeScript，strict 模式
- **配置:** `~/.yee88/yee88.toml`（TOML 格式）
- **状态持久化:** JSON 文件（`~/.yee88/sessions.json`, `~/.yee88/topics.json`）

## Code Style

### Imports

- 使用 `.ts` 扩展名：`import { foo } from "./bar.ts"`
- 类型导入使用 `import type`：`import type { AppConfig } from "../config/index.ts"`
- 第三方库在前，本地模块在后，空行分隔
- Zod 从 `"zod/v4"` 导入（项目使用 Zod v4）

### Naming

- 文件名：`kebab-case.ts`（如 `opencode.ts`, `guard.ts`）
- 类型/接口：`PascalCase`（如 `RunContext`, `ThreadJob`）
- 函数：`camelCase`（如 `createBot`, `loadAppConfig`）
- 常量：`UPPER_SNAKE_CASE`（如 `STATE_VERSION`, `ENGINE`）
- 私有字段：无前缀，使用 `private` 关键字

### Types

- 优先使用 `interface` 定义对象类型，`type` 用于联合类型和别名
- Zod schema 命名：`XxxSchema`，推导类型：`type Xxx = z.infer<typeof XxxSchema>`
- 使用 `Record<string, unknown>` 而非 `any`（除测试 mock 外）
- 启用 `noUncheckedIndexedAccess`，索引访问后需用 `!` 或条件检查

### Functions

- 优先使用独立函数而非类方法（除非需要状态管理）
- 有状态模块使用 class（如 `SessionStore`, `TopicStateStore`, `ThreadScheduler`）
- Helper constructors 使用 `createXxx` 命名（如 `createStartedEvent`）
- 工厂函数使用 `createXxx` 或 `newXxx` 命名

### Error Handling

- 自定义错误类继承 `Error`，设置 `this.name`（如 `ConfigError`）
- 异步操作使用 `try/catch`，catch 块中用 `consola.error` 记录
- 文件 I/O 失败时静默降级（如 `loadIfNeeded` 中的空 catch）
- 原子写入：先写 `.tmp` 文件再 `rename`

### Logging

- 使用 `consola`（不要用 `console.log`）
- 日志前缀格式：`[module]`（如 `[server]`, `[bot]`, `[scheduler]`）

### Comments

- 文件头注释：`// src/path/to.ts - 模块简述`
- 中文注释为主，保持已有注释不变
- JSDoc 用于公共接口和复杂逻辑

### Testing Patterns

- 从 `"bun:test"` 导入 `test, expect, describe, beforeEach, afterEach`
- Mock 对象使用 `as any` 类型断言
- 临时文件使用 `mkdtempSync` + `afterEach` 清理
- 异步等待使用 `Bun.sleep()`
- 测试结构：`describe("ModuleName", () => { test("behavior", ...) })`

## Bun-Specific APIs

- `Bun.serve()` 处理 HTTP（不要用 express）
- `Bun.spawn()` 运行子进程
- `Bun.sleep()` 替代 `setTimeout` promise
- `Bun.file()` 读文件（但项目中持久化模块仍用 `node:fs` 同步 API）
- `.env` 自动加载，不需要 dotenv

## Key Dependencies

- `chat` + `@chat-adapter/telegram` — Chat SDK 和 Telegram 适配器
- `zod` (v4) — Schema 校验
- `@iarna/toml` — TOML 解析/序列化
- `consola` — 日志

## Architecture Notes

- **Session 隔离:** Topic 级别 > Chat 级别，支持多项目多分支并行
- **事件流:** OpenCode CLI → JSONL 流 → `Yee88Event` → Markdown 渲染 → Telegram 消息
- **调度:** `ThreadScheduler` 保证同一 session 串行执行，不同 session 并行
- **配置层级:** 项目配置 > 全局配置（system_prompt, engine 等）