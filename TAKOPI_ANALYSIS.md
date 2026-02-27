# Takopi 项目架构分析

## 项目概述

**Takopi (yee88)** 是一个 Telegram Bot 桥接多个 AI 编程助手（Codex, Claude Code, OpenCode, Pi）的 Python 项目。

- **语言**: Python 3.14+
- **包管理**: uv
- **核心功能**: 通过 Telegram 与 AI 编程助手交互，支持流式更新、多项目管理、Git worktrees

---

## 核心架构

### 1. 分层设计

```
Telegram Bot (telegram/bridge.py)
    ↓
Transport Layer (transport.py, telegram/bridge.py)
    ↓
Runner Bridge (runner_bridge.py)
    ↓
Engine Runners (runners/opencode.py, runners/codex.py, etc.)
    ↓
CLI Tools (opencode, codex, claude, pi)
```

### 2. 关键模块

#### **OpenCode Runner** (`runners/opencode.py`)

**职责**: 调用 OpenCode CLI 并解析 JSONL 流输出

**核心类**: `OpenCodeRunner`
- 继承自 `JsonlSubprocessRunner` 和 `ResumeTokenMixin`
- 使用 `Bun.spawn()` 启动子进程
- 解析 JSONL 事件流

**事件类型** (定义在 `schemas/opencode.py`):
```python
type OpenCodeEvent = StepStart | StepFinish | ToolUse | Text | Error
```

**事件流处理**:
1. `StepStart`: 会话开始，提取 `sessionID`，发出 `StartedEvent`
2. `ToolUse`: 工具调用
   - `status="started"`: 发出 `ActionEvent(phase="started")`
   - `status="completed"`: 发出 `ActionEvent(phase="completed", ok=True)`
   - `status="error"`: 发出 `ActionEvent(phase="completed", ok=False)`
3. `Text`: 累积文本到 `state.last_text`
4. `StepFinish`: 
   - `reason="stop"`: 发出 `CompletedEvent(ok=True, answer=last_text)`
5. `Error`: 发出 `CompletedEvent(ok=False, error=message)`

**状态管理** (`OpenCodeStreamState`):
```python
@dataclass(slots=True)
class OpenCodeStreamState:
    pending_actions: dict[str, Action]  # 跟踪进行中的工具调用
    last_text: str | None               # 累积的文本输出
    note_seq: int
    session_id: str | None              # ses_XXXX 格式
    emitted_started: bool
    saw_step_finish: bool
```

**CLI 调用**:
```python
def build_args(self, prompt, resume, *, state):
    args = ["run", "--format", "json"]
    if resume is not None:
        args.extend(["--session", resume.value])
    if model is not None:
        args.extend(["--model", model])
    args.extend(["--", prompt])
    return args
```

**事件翻译** (`translate_opencode_event`):
- 将 OpenCode 的 JSONL 事件转换为 Takopi 的统一事件模型 (`TakopiEvent`)
- 提取工具调用信息（`_extract_tool_action`）
- 处理工具状态变化（started → completed/error）

---

#### **Runner Bridge** (`runner_bridge.py`)

**职责**: 连接 Runner 和 Transport，管理消息编辑和进度更新

**核心类**: `ProgressEdits`

**消息编辑流程**:
```python
class ProgressEdits:
    async def run(self):
        while True:
            # 等待事件信号
            await self.signal_recv.receive()
            
            # 渲染进度状态
            state = self.tracker.snapshot(...)
            rendered = self.presenter.render_progress(state, elapsed_s=...)
            
            # 编辑消息（如果内容变化）
            if rendered != self.last_rendered:
                edited = await self.transport.edit(
                    ref=self.progress_ref,
                    message=rendered,
                    wait=False  # 非阻塞编辑
                )
                if edited is not None:
                    self.last_rendered = rendered
    
    async def on_event(self, evt: TakopiEvent):
        # 更新 tracker
        if not self.tracker.note_event(evt):
            return
        # 发送信号触发渲染
        self.event_seq += 1
        self.signal_send.send_nowait(None)
```

**关键函数**:
- `_send_or_edit_message`: 智能选择发送新消息或编辑现有消息
- `send_initial_progress`: 发送初始进度消息
- `run_runner_with_cancel`: 运行 Runner 并处理取消

**消息编辑策略**:
1. 如果 `edit_ref` 存在，先尝试编辑
2. 编辑失败则发送新消息
3. 支持 `followups`（多条消息分割）

---

#### **Telegram Transport** (`telegram/bridge.py`)

**职责**: 实现 `Transport` 协议，处理 Telegram API 调用

**核心类**: `TelegramTransport`

**消息编辑实现**:
```python
async def edit(self, *, ref: MessageRef, message: RenderedMessage, wait: bool = True):
    chat_id = cast(int, ref.channel_id)
    message_id = cast(int, ref.message_id)
    entities = message.extra.get("entities")
    reply_markup = message.extra.get("reply_markup")
    
    # 调用 Telegram API
    edited = await self._bot.edit_message_text(
        chat_id=chat_id,
        message_id=message_id,
        text=message.text,
        entities=entities,
        parse_mode=parse_mode,
        reply_markup=reply_markup,
        wait=wait  # 控制是否等待 API 响应
    )
    
    # 处理 followups（消息分割）
    if followups:
        await self._send_followups(...)
    
    return MessageRef(...)
```

**Telegram Client** (`telegram/client.py`):
- 使用 `TelegramOutbox` 管理请求队列
- 支持速率限制（私聊 1 msg/s，群聊 20 msg/min）
- 编辑操作优先级高于发送（`EDIT_PRIORITY > SEND_PRIORITY`）

```python
async def edit_message_text(self, chat_id, message_id, text, entities, ...):
    async def execute():
        return await self._client.edit_message_text(...)
    
    return await self.enqueue_op(
        key=("edit", chat_id, message_id),  # 去重键
        label="edit_message_text",
        execute=execute,
        priority=EDIT_PRIORITY,
        chat_id=chat_id,
        wait=wait
    )
```

---

#### **Progress Tracker** (`progress.py`)

**职责**: 跟踪工具调用状态，生成进度快照

**核心类**: `ProgressTracker`

```python
class ProgressTracker:
    def note_event(self, event: TakopiEvent) -> bool:
        match event:
            case StartedEvent(resume=resume):
                self.resume = resume
                return True
            case ActionEvent(action=action, phase=phase, ok=ok):
                # 跟踪工具调用状态
                action_id = str(action.id)
                self._actions[action_id] = ActionState(
                    action=action,
                    phase=phase,
                    ok=ok,
                    completed=(phase == "completed"),
                    ...
                )
                return True
    
    def snapshot(self, ...) -> ProgressState:
        # 生成当前进度快照
        return ProgressState(
            engine=self.engine,
            action_count=self.action_count,
            actions=tuple(sorted(self._actions.values(), ...)),
            resume=self.resume,
            resume_line=resume_formatter(self.resume) if self.resume else None,
            ...
        )
```

---

#### **Markdown Rendering** (`telegram/render.py`)

**职责**: 将 Markdown 渲染为 Telegram 格式

**核心函数**:
- `render_markdown(md: str) -> tuple[str, list[dict]]`: 渲染 Markdown 为 Telegram 文本 + entities
- `split_markdown_body(body: str, max_chars: int) -> list[str]`: 分割长消息（保持代码块完整）

**消息分割策略**:
1. 按段落分割（`\n{2,}`）
2. 保持代码块完整（跟踪 fence 状态）
3. 长行截断（最大 2000 字符/行）
4. 总长度限制 3500 字符

---

## 工具调用处理流程

### 完整流程图

```
OpenCode CLI (JSONL 流)
    ↓
OpenCodeRunner.run() (异步生成器)
    ↓ 解析 JSONL
translate_opencode_event()
    ↓ 转换为 TakopiEvent
ProgressEdits.on_event()
    ↓ 更新 tracker
ProgressTracker.note_event()
    ↓ 记录 ActionState
ProgressEdits.run() (后台任务)
    ↓ 渲染进度
TelegramPresenter.render_progress()
    ↓ 生成 RenderedMessage
TelegramTransport.edit()
    ↓ 调用 Telegram API
TelegramClient.edit_message_text()
    ↓ 入队到 Outbox
TelegramOutbox (速率限制队列)
    ↓ 执行 API 调用
Telegram Bot API
```

### 关键时序

1. **工具调用开始** (`ToolUse` with `status="started"`):
   ```
   OpenCode → ActionEvent(phase="started") 
           → ProgressTracker 记录 pending action
           → 触发消息编辑（显示 "⏳ tool_name"）
   ```

2. **工具调用完成** (`ToolUse` with `status="completed"`):
   ```
   OpenCode → ActionEvent(phase="completed", ok=True/False)
           → ProgressTracker 更新 action 状态
           → 触发消息编辑（显示 "✓ tool_name" 或 "✗ tool_name"）
   ```

3. **文本输出** (`Text`):
   ```
   OpenCode → 累积到 state.last_text
           → 不触发消息编辑（等待 StepFinish）
   ```

4. **会话完成** (`StepFinish` with `reason="stop"`):
   ```
   OpenCode → CompletedEvent(answer=last_text)
           → 发送最终消息（包含完整答案）
           → 清除 reply_markup（移除 cancel 按钮）
   ```

---

## 消息编辑策略

### 1. 非阻塞编辑 (`wait=False`)

**用于**: 进度更新（高频）

```python
edited = await self.transport.edit(
    ref=self.progress_ref,
    message=rendered,
    wait=False  # 不等待 API 响应
)
```

**优点**:
- 不阻塞事件处理循环
- 允许快速连续更新
- Telegram API 会自动合并过于频繁的编辑

### 2. 阻塞编辑 (`wait=True`)

**用于**: 最终消息（低频）

```python
edited = await self.transport.edit(
    ref=final_ref,
    message=final_rendered,
    wait=True  # 等待 API 响应
)
```

**优点**:
- 确保消息已更新
- 获取最新的 `message_id`

### 3. 消息分割 (`followups`)

**触发条件**: 消息超过 3500 字符

```python
if self._message_overflow == "split":
    payloads = prepare_telegram_multi(parts, max_body_chars=MAX_BODY_CHARS)
    # 第一条消息编辑原消息
    # 后续消息作为 followups 发送
    extra["followups"] = [RenderedMessage(...) for ...]
```

---

## 与 yee88-chat-ai 的对比

| 特性 | Takopi (Python) | yee88-chat-ai (TypeScript) |
|------|-----------------|----------------------------|
| **Runtime** | Python 3.14+ | Bun |
| **架构** | 分层（Transport/Runner/Bridge） | 类似分层 |
| **事件模型** | `TakopiEvent` (统一) | `Yee88Event` (统一) |
| **消息编辑** | `TelegramTransport.edit()` | `adapter.editMessage()` |
| **进度更新** | `ProgressEdits` (后台任务) | 需实现类似机制 |
| **速率限制** | `TelegramOutbox` (队列) | 需实现 |
| **消息分割** | `split_markdown_body()` | `splitMarkdown()` |
| **工具跟踪** | `ProgressTracker` | 需实现 |
| **非阻塞编辑** | `wait=False` | 需支持 |

---

## 关键学习点

### 1. **事件驱动架构**
- Runner 产生事件流（异步生成器）
- Bridge 消费事件并触发 UI 更新
- Tracker 维护状态快照

### 2. **消息编辑优化**
- 非阻塞编辑 (`wait=False`) 用于高频更新
- 使用信号机制 (`anyio.Event`) 触发渲染
- 只在内容变化时编辑（`rendered != last_rendered`）

### 3. **工具调用跟踪**
- 使用 `action_id` 作为唯一标识
- 跟踪 `started` → `completed` 状态转换
- 支持并发工具调用（`pending_actions` 字典）

### 4. **速率限制**
- 使用优先级队列（`TelegramOutbox`）
- 编辑操作优先级高于发送
- 按 `chat_id` 分组限流

### 5. **消息分割**
- 保持代码块完整（跟踪 fence 状态）
- 第一条消息编辑原消息
- 后续消息作为新消息发送

---

## 实现建议（for yee88-chat-ai）

### 1. **引入 ProgressTracker**
```typescript
class ProgressTracker {
  private actions = new Map<string, ActionState>();
  
  noteEvent(event: Yee88Event): boolean {
    if (event.type === "action") {
      const { action, phase, ok } = event;
      this.actions.set(action.id, {
        action,
        phase,
        ok,
        completed: phase === "completed"
      });
      return true;
    }
    return false;
  }
  
  snapshot(): ProgressState {
    return {
      actions: Array.from(this.actions.values()),
      // ...
    };
  }
}
```

### 2. **实现非阻塞编辑**
```typescript
// DingTalk adapter
async editMessage(threadId, messageId, text, options?: { wait?: boolean }) {
  if (options?.wait === false) {
    // 发起编辑但不等待响应
    this.editQueue.push({ threadId, messageId, text });
    return { success: true };
  }
  // 阻塞编辑
  return await this.streamAICard(...);
}
```

### 3. **后台编辑任务**
```typescript
class ProgressEdits {
  private eventSeq = 0;
  private renderedSeq = 0;
  private signal = new EventEmitter();
  
  async run() {
    while (true) {
      await this.signal.once("update");
      
      if (this.renderedSeq === this.eventSeq) continue;
      
      const state = this.tracker.snapshot();
      const rendered = this.presenter.renderProgress(state);
      
      if (rendered !== this.lastRendered) {
        await this.transport.edit(this.progressRef, rendered, { wait: false });
        this.lastRendered = rendered;
      }
      
      this.renderedSeq = this.eventSeq;
    }
  }
  
  onEvent(evt: Yee88Event) {
    if (this.tracker.noteEvent(evt)) {
      this.eventSeq++;
      this.signal.emit("update");
    }
  }
}
```

### 4. **优化 OpenCode Runner**
```typescript
// 在 runner/opencode.ts 中
async *run(prompt: string, resume?: ResumeToken) {
  const state = new OpenCodeStreamState();
  const proc = Bun.spawn([...]);
  
  for await (const line of proc.stdout) {
    const event = decodeEvent(line);
    const takopiEvents = translateEvent(event, state);
    
    for (const evt of takopiEvents) {
      yield evt;  // 立即 yield，不等待消息编辑
    }
  }
}
```

---

## 总结

Takopi 的核心优势：
1. **清晰的分层架构**: Transport/Runner/Bridge 职责分明
2. **高效的消息编辑**: 非阻塞 + 信号驱动 + 内容去重
3. **完善的工具跟踪**: ProgressTracker 维护完整状态
4. **智能的速率限制**: 优先级队列 + 按 chat 分组

yee88-chat-ai 可以借鉴的关键点：
- 引入 `ProgressTracker` 跟踪工具状态
- 实现非阻塞消息编辑（`wait=false`）
- 使用后台任务处理进度更新
- 优化事件流处理（立即 yield，不阻塞）