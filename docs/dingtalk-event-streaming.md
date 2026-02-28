# DingTalk 事件流处理设计文档

> 本文档记录从 CoPaw 项目借鉴的流式消息处理思路，用于在 yee88-chat-ai 中实现多步骤任务的消息发送机制。

## 背景

当前 yee88-chat-ai 的 DingTalk 适配器支持两种消息发送方式：
1. **AI Card Streaming** - 打字机效果，单条消息实时更新（仅群聊）
2. **Proactive API / Session Webhook** - 发送独立消息

但对于需要多工具调用的长任务，用户需要看到**中间过程的反馈**，而不是等待最终结果。

## CoPaw 的事件流模型

### 核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                      Agent 处理流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   用户提问 ──→ _process(request) ──→ 产生 Event 流              │
│                                          ↓                      │
│                              async for event in events          │
│                                          ↓                      │
│                              每个 Completed 事件                  │
│                                          ↓                      │
│                              立即发送一条消息                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 事件类型

```python
# 来自 agentscope_runtime 的 Event 对象
class Event:
    object: str      # "message" | "response" | "tool_call" | ...
    status: str      # "in_progress" | "completed" | "failed"
    type: str        # "text" | "tool_calls" | "function" | ...
```

### 关键处理逻辑

```python
# channel.py:1151-1210
async for event in self._process(request):
    obj = getattr(event, "object", None)
    status = getattr(event, "status", None)
    
    # 只处理已完成的消息
    if obj == "message" and status == RunStatus.Completed:
        parts = self._message_to_content_parts(event)
        
        # 有 SessionWebhook 时：逐条发送
        if use_multi and parts and session_webhook:
            body = self._parts_to_single_text(parts)
            await self._send_via_session_webhook(session_webhook, body)
            
            # 媒体文件单独发送
            for part in media_parts:
                await self._send_media_part_via_webhook(session_webhook, part)
```

## 多工具调用场景示例

### 用户提问
> "查一下北京天气，然后计算 23*45"

### CoPaw 的处理流程

```
时间线 ──────────────────────────────────────────────────────→

[Event 1] object="message" status="completed" type="text"
          content="正在查询北京天气..."
          ↓
          发送消息 1: "正在查询北京天气..."

[Event 2] object="message" status="completed" type="tool_calls"
          content="北京今天晴朗，15-25°C"
          ↓
          发送消息 2: "北京今天晴朗，15-25°C ☀️"

[Event 3] object="message" status="completed" type="text"
          content="正在计算..."
          ↓
          发送消息 3: "正在计算..."

[Event 4] object="message" status="completed" type="function"
          content="23 * 45 = 1035"
          ↓
          发送消息 4: "23 * 45 = 1035"

[Event 5] object="message" status="completed" type="text"
          content="任务完成！"
          ↓
          发送消息 5: "任务完成！"
```

### 用户看到的对话

```
[你] 查一下北京天气，然后计算 23*45

[Bot] 正在查询北京天气...
[Bot] 北京今天晴朗，15-25°C ☀️
[Bot] 正在计算...
[Bot] 23 * 45 = 1035
[Bot] 任务完成！
```

## 与 AI Card Streaming 的对比

| 特性 | 逐条发送 (CoPaw) | AI Card Streaming |
|------|-----------------|-------------------|
| **视觉效果** | 多条独立消息 | 单条消息打字机效果 |
| **适用场景** | 私聊、群聊 | 仅群聊 |
| **中间反馈** | ✅ 每个步骤都有反馈 | ⚠️ 需要额外设计 |
| **消息数量** | 可能多条 | 始终一条 |
| **实现复杂度** | 简单 | 需要卡片模板 |
| **用户体验** | 清晰但消息多 | 紧凑但可能信息丢失 |

## 在 yee88-chat-ai 中的实现方案

### 方案 1: 扩展 editMessage 支持多步骤

利用现有的 `editMessage` 机制，但改为**发送新消息**而不是编辑。

```typescript
// packages/adapter-dingtalk/src/index.ts
async editMessage(
  threadId: string,
  messageId: string,
  message: AdapterPostableMessage,
  options?: { isNewStep?: boolean }  // 新增选项
): Promise<RawMessage<DingTalkRawMessage>> {
  if (options?.isNewStep) {
    // 新步骤：发送新消息而不是编辑
    return this.postMessage(threadId, message);
  }
  
  // 原有逻辑：尝试编辑
  // ...
}
```

### 方案 2: 新增 streamMessage API

参考 CoPaw 的 `_process_one_request`，在 Adapter 中实现事件流处理。

```typescript
// 新增类型定义
interface StreamEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'status';
  content: string;
  status: 'in_progress' | 'completed';
  metadata?: Record<string, unknown>;
}

// Adapter 新增方法
async *streamMessage(
  threadId: string,
  message: AdapterPostableMessage
): AsyncGenerator<StreamEvent, void, unknown> {
  // 1. 发送初始状态
  yield { type: 'status', content: '思考中...', status: 'in_progress' };
  
  // 2. 调用 Chat SDK 处理
  const stream = await this.chat.processStream(threadId, message);
  
  // 3. 转发事件流
  for await (const event of stream) {
    yield event;
    
    // 4. 每个 completed 事件发送一条消息
    if (event.status === 'completed') {
      await this.postMessage(threadId, { text: event.content });
    }
  }
  
  // 5. 完成
  yield { type: 'status', content: '完成', status: 'completed' };
}
```

### 方案 3: 混合模式 (推荐)

结合 AI Card 和逐条发送的优势：

```typescript
// 群聊：使用 AI Card 展示流式过程
// 私聊：使用逐条发送

async postMessageWithStreaming(
  threadId: string,
  message: AdapterPostableMessage,
  stream: AsyncIterable<StreamChunk>
): Promise<void> {
  const isGroup = this.isGroupThread(threadId);
  
  if (isGroup && this.config.cardTemplateId) {
    // 群聊：AI Card 流式更新
    const card = await createAICard(...);
    for await (const chunk of stream) {
      await streamAICard(card, chunk.content, chunk.isFinal);
    }
  } else {
    // 私聊：逐条发送
    for await (const chunk of stream) {
      if (chunk.isCompleted) {
        await this.postMessage(threadId, { text: chunk.content });
      }
    }
  }
}
```

## 实现步骤

### Phase 1: 基础事件流支持
1. 在 `types.ts` 中定义 `StreamEvent` 类型
2. 在 `DingTalkAdapter` 中添加 `postMessageStream` 方法
3. 实现私聊场景的逐条发送

### Phase 2: 群聊 AI Card 优化
1. 扩展 AI Card 支持多步骤展示
2. 在卡片中显示"步骤 1/3"等进度信息
3. 支持工具调用结果的格式化展示

### Phase 3: Chat SDK 集成
1. 在 `Chat` 类中添加 `processStream` 方法
2. 支持 Agent 返回 AsyncIterable 事件流
3. 适配器自动选择最佳发送策略

## 参考代码

### CoPaw 核心逻辑
```python
# src/copaw/app/channels/dingtalk/channel.py:1151-1220
async for event in self._process(request):
    if obj == "message" and status == RunStatus.Completed:
        parts = self._message_to_content_parts(event)
        if use_multi and parts and session_webhook:
            # 立即发送
            await self._send_via_session_webhook(session_webhook, body)
```

### yee88-chat-ai 当前实现
```typescript
// packages/adapter-dingtalk/src/index.ts:628-646
async editMessage(threadId, messageId, message) {
  // Strategy 1: AI Card streaming
  const existingCard = this.aiCardCache.get(messageId);
  if (existingCard) {
    const success = await streamAICard(existingCard, text, false, this.logger);
    if (success) {
      this.scheduleAutoFinalize(messageId, text);
      return this.createSyntheticRawMessage(threadId, messageId, text);
    }
  }
  // ...
}
```

## 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 私聊流式方案 | 逐条发送 | AI Card 不支持私聊 |
| 群聊流式方案 | AI Card 为主 | 用户体验更好 |
| 事件粒度 | Completed 级别 | 避免消息过于碎片化 |
| 媒体处理 | 分开发送 | 钉钉限制，文本和媒体需分开 |

## 后续优化方向

1. **消息合并**：短时间内多个小事件合并为一条消息
2. **编辑优化**：支持编辑最近一条消息（类似 CoPaw 的 EditManager）
3. **进度指示**：长任务显示进度条或步骤指示器
4. **撤回支持**：Proactive API 支持撤回旧消息