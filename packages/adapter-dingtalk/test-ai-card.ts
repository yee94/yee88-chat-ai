/**
 * DingTalk AI Card 流式响应测试
 *
 * 使用钉钉标准 AI 卡片模板实现流式响应。
 */

import { createStreamClient, createDingTalkAdapter } from "./src/index.js";

const config = {
  clientId: "ding5mfchuedme8ij6co",
  clientSecret: "GpOoqTvooj9a0dLijCSukS7GWYns6Ia8Gud-ijaqX7XaiGd_J39SVwGf_ytrJWoI",
  robotCode: "ding5mfchuedme8ij6co",
  corpId: "dingd8e1123006514592",
  agentId: "4213108944",
  // 不设置 cardTemplateId，使用钉钉标准 AI 卡片模板
};

console.log("🚀 DingTalk AI Card 流式响应测试");
console.log("=".repeat(50));

const adapter = createDingTalkAdapter(config);

const stream = createStreamClient({ ...config, debug: false });

stream.onStateChange((state, error) => {
  console.log(`📡 状态: ${state}${error ? ` (${error})` : ""}`);
});

stream.onMessage(async (message, ack) => {
  console.log("");
  console.log("=".repeat(50));
  console.log(`📨 收到: "${message.text?.content ?? message.msgtype}"`);
  console.log(`   发送者: ${message.senderNick} (staffId: ${message.senderStaffId})`);
  console.log(`   会话类型: ${message.conversationType === "2" ? "群聊" : "单聊"}`);
  console.log(`   conversationId: ${message.conversationId}`);
  console.log("=".repeat(50));

  ack();

  const threadId = adapter.encodeThreadId({
    conversationId: message.conversationId,
    conversationType: message.conversationType as "1" | "2",
  });

  // 缓存 staffId 用于 DM
  if (message.conversationType === "1" && message.senderStaffId) {
    (adapter as any).staffIdCache.set(threadId, message.senderStaffId);
  }
  if (message.sessionWebhook) {
    (adapter as any).sessionWebhookCache.set(threadId, message.sessionWebhook);
  }

  try {
    // 第一步：发送初始消息（创建 AI Card）
    console.log("\n📤 [1/6] 发送初始消息 (创建 AI Card)...");
    const rawMsg = await adapter.postMessage(threadId, "🤔 正在思考...");
    const messageId = rawMsg.id;
    console.log(`   消息 ID: ${messageId}`);

    const isAICard = messageId.startsWith("aicard:");
    console.log(`   是否 AI Card: ${isAICard ? "✅ 是" : "❌ 否"}`);

    if (!isAICard) {
      console.log("⚠️ AI Card 未创建，跳过流式测试");
      return;
    }

    // 检查 cache
    const cacheHit = (adapter as any).aiCardCache.has(messageId);
    console.log(`   Cache 命中: ${cacheHit ? "✅" : "❌"}`);

    // 第二步：流式更新 - 逐步添加内容
    const updates = [
      "好的，让我来回答你的问题。",
      "好的，让我来回答你的问题。\n\n这是一个 **AI Card** 流式响应测试。",
      "好的，让我来回答你的问题。\n\n这是一个 **AI Card** 流式响应测试。\n\n内容正在逐步生成中...",
      "好的，让我来回答你的问题。\n\n这是一个 **AI Card** 流式响应测试。\n\n✅ 流式输出完成！",
    ];

    for (let i = 0; i < updates.length; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      console.log(`\n📝 [${i + 2}/6] 更新内容 (${i + 1}/${updates.length})...`);
      
      // 检查 cache 状态
      const card = (adapter as any).aiCardCache.get(messageId);
      console.log(`   Cache: ${card ? `state=${card.state}` : "MISS"}`);
      
      const result = await adapter.editMessage(threadId, messageId, updates[i]!);
      console.log(`   结果 ID: ${result.id}`);
      console.log(`   是否同一消息: ${result.id === messageId ? "✅" : "❌ 新消息!"}`);
    }

    // 第六步：完成流式输出
    await new Promise((r) => setTimeout(r, 500));
    console.log("\n✅ [6/6] 完成流式输出...");
    await adapter.finalizeMessage(threadId, messageId, updates[updates.length - 1]!);

    console.log("\n🎉 AI Card 流式响应测试完成！");
  } catch (error) {
    console.error("\n❌ 错误:", error);
  }
});

console.log("正在连接 DingTalk Stream...");
stream.connect().catch(console.error);

process.on("SIGINT", async () => {
  console.log("\n正在断开连接...");
  await stream.disconnect();
  process.exit(0);
});