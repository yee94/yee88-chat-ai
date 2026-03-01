# AGENTS.md — yee88

Telegram / DingTalk Bot 桥接 OpenCode CLI 的 AI 编程助手。pnpm + Turbo monorepo，Bun runtime。

## Build & Run

```bash
# Monorepo 根目录（pnpm + turbo）
pnpm install                          # 安装依赖（根 package.json 强制 pnpm）
pnpm run dev                          # turbo 并行 dev 所有 packages
pnpm run build                        # turbo 构建所有 packages
pnpm run test                         # turbo 运行所有 packages 测试
pnpm run typecheck                    # turbo 运行所有 packages 类型检查

# packages/yee88（Bun runtime）
bun test                              # 运行 yee88 所有测试（bun:test）
bun test --filter "guard"             # 按 describe/test 名称过滤
bun test src/__tests__/guard.test.ts  # 运行单个测试文件
bun run dev                           # 开发模式（--hot）
bun run start                         # 生产模式
bun run cli                           # CLI 入口
tsc --noEmit                          # 类型检查

# packages/adapter-dingtalk（vitest）
pnpm run test                         # vitest run
pnpm run test:watch                   # vitest watch 模式
pnpm run build                        # tsdown 构建
tsc --noEmit                          # 类型检查
```

## Project Structure

```
packages/
├── yee88/                    # 主应用 - Bot 服务（Bun runtime, bun:test）
│   └── src/
│       ├── index.ts          # 主入口
│       ├── model.ts          # 核心领域模型（Event, Action, ResumeToken）
│       ├── chat/             # Bot 逻辑（server, bot, guard, polling, state）
│       ├── config/index.ts   # TOML 配置管理（Zod schema）
│       ├── runner/           # OpenCode CLI Runner（JSONL 流解析）
│       ├── schema/           # OpenCode 事件 Zod schema
│       ├── session/          # Session resume token 持久化 + 异步锁
│       ├── topic/            # Topic 级别状态管理
│       ├── scheduler/        # 线程任务调度器
│       ├── markdown/         # Markdown 渲染、消息分割
│       ├── cli/              # CLI 子命令路由 + onboarding
│       └── __tests__/        # 所有测试文件
│
└── adapter-dingtalk/         # DingTalk 适配器（tsdown 构建, vitest 测试）
    └── src/                  # stream, auth, cards, markdown, types
```

## Runtime & Tooling

- **包管理:** pnpm（根目录强制，不要用 npm / yarn）
- **任务编排:** Turbo（`pnpm run <task>` 在根目录触发 turbo）
- **Runtime:** Bun（yee88 包的运行和测试）
- **构建:** tsdown（adapter-dingtalk 包）
- **语言:** TypeScript，strict 模式
- **配置:** `~/.yee88/config.toml`（TOML 格式）
- **状态持久化:** JSON 文件（`~/.yee88/sessions.json`, `~/.yee88/topics.json`）

## Code Style

### Imports

- 使用 `.ts` 扩展名：`import { foo } from "./bar.ts"`
- 类型导入使用 `import type`：`import type { AppConfig } from "../config/index.ts"`
- 第三方库在前，本地模块在后，空行分隔
- Zod 从 `"zod/v4"` 导入（项目使用 Zod v4）
- yee88 包支持 path alias：`@/*` → `src/*`

### Naming

- 文件名：`kebab-case.ts`（如 `opencode.ts`, `bot-dingtalk.ts`）
- 类型/接口：`PascalCase`（如 `RunContext`, `ThreadJob`）
- 函数：`camelCase`（如 `createBot`, `loadAppConfig`）
- 常量：`UPPER_SNAKE_CASE`（如 `STATE_VERSION`, `ENGINE`）
- 私有字段：无前缀，使用 `private` 关键字

### Types

- 优先使用 `interface` 定义对象类型，`type` 用于联合类型和别名
- Zod schema 命名：`XxxSchema`，推导类型：`type Xxx = z.infer<typeof XxxSchema>`
- 使用 `Record<string, unknown>` 而非 `any`（除测试 mock 外）
- 启用 `noUncheckedIndexedAccess`，索引访问后需用 `!` 或条件检查
- 启用 `verbatimModuleSyntax`，类型导入必须用 `import type`

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

## Testing Patterns

两个包使用不同的测试框架，注意区分：

### yee88（bun:test）

- 测试文件位于 `packages/yee88/src/__tests__/<module>.test.ts`
- 从 `"bun:test"` 导入 `test, expect, describe, beforeEach, afterEach`
- Mock 对象使用 `as any` 类型断言
- 临时文件使用 `mkdtempSync` + `afterEach` 清理
- 异步等待使用 `Bun.sleep()`
- 测试结构：`describe("ModuleName", () => { test("behavior", ...) })`

### adapter-dingtalk（vitest）

- 测试文件位于 `packages/adapter-dingtalk/src/*.test.ts`（与源码同目录）
- 从 `"vitest"` 导入 `describe, it, expect, vi, beforeEach, afterEach`
- Mock 使用 `vi.fn()`，全局 stub 使用 `vi.stubGlobal()`
- 清理使用 `vi.unstubAllGlobals()`
- 类型断言使用 `as unknown as Type`

## Bun-Specific APIs（yee88 包）

- `Bun.serve()` 处理 HTTP（不要用 express）
- `Bun.spawn()` 运行子进程
- `Bun.sleep()` 替代 `setTimeout` promise
- `Bun.file()` 读文件（但持久化模块仍用 `node:fs` 同步 API）
- `.env` 自动加载，不需要 dotenv

## Key Dependencies

- `chat` + `@chat-adapter/telegram` — Chat SDK 和 Telegram 适配器
- `@chat-adapter/dingtalk` — DingTalk 适配器（workspace 内部包）
- `zod` (v4) — Schema 校验（从 `"zod/v4"` 导入）
- `@iarna/toml` — TOML 解析/序列化
- `consola` — 日志

## Architecture Notes

- **Session 隔离:** Topic 级别 > Chat 级别，支持多项目多分支并行
- **事件流:** OpenCode CLI → JSONL 流 → `Yee88Event` → Markdown 渲染 → Telegram 消息
- **调度:** `ThreadScheduler` 保证同一 session 串行执行，不同 session 并行
- **配置层级:** 项目配置 > 全局配置（system_prompt, engine 等）