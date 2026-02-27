/**
 * AI Card 调试测试 - 测试单聊 (DM)
 * 
 * 群聊可能有权限问题，先测试单聊
 */

import { createStreamClient, createDingTalkAdapter } from "./src/index.js";

const config = {
  clientId: "ding5mfchuedme8ij6co",
  clientSecret: "GpOoqTvooj9a0dLijCSukS7GWYns6Ia8Gud-ijaqX7XaiGd_J39SVwGf_ytrJWoI",
  robotCode: "ding5mfchuedme8ij6co",
  cardTemplateId: "35813773-9c79-4091-89a1-d6b5cc3547d2.schema",
  cardTemplateKey: "content",
};

console.log("🚀 AI Card 单聊测试");
console.log("请在钉钉中 **私聊** 机器人（不是群聊）");
console.log("=".repeat(50));

const adapter = createDingTalkAdapter(config);
const stream = createStreamClient({ ...config, debug: false });

stream.onStateChange((state, error) => {
  console.log(`📡 状态: ${state}${error ? ` (${error})` : ""}`);
});

stream.onMessage(async (message, ack) => {
  console.log("\n收到消息，完整数据:");
  console.log(JSON.stringify(message, null, 2));
  
  ack();

  const isGroup = message.conversationType === "2";
  console.log(`\n会话类型: ${isGroup ? "群聊" : "单聊"}`);
  console.log(`conversationId: ${message.conversationId}`);
  
  // 检查是否有 openConversationId
  const openConvId = (message as any).openConversationId;
  if (openConvId) {
    console.log(`openConversationId: ${openConvId}`);
  }

  const threadId = adapter.encodeThreadId({
    conversationId: message.conversationId,
    conversationType: message.conversationType as "1" | "2",
  });

  // 缓存必要信息
  if (message.conversationType === "1" && message.senderStaffId) {
    (adapter as any).staffIdCache.set(threadId, message.senderStaffId);
  }
  if (message.sessionWebhook) {
    (adapter as any).sessionWebhookCache.set(threadId, message.sessionWebhook);
  }

  try {
    console.log("\n📤 尝试创建 AI Card...");
    const rawMsg = await adapter.postMessage(threadId, "🤔 正在思考...");
    console.log(`消息 ID: ${rawMsg.id}`);
    
    const isAICard = rawMsg.id.startsWith("aicard:");
    if (isAICard) {
      console.log("✅ AI Card 创建成功！");
      
      await new Promise(r => setTimeout(r, 1000));
      await adapter.editMessage(threadId, rawMsg.id, "✅ AI Card 测试成功！");
      await adapter.finalizeMessage(threadId, rawMsg.id, "✅ AI Card 测试成功！");
    } else {
      console.log("⚠️ 降级到其他策略");
    }
  } catch (error) {
    console.error("❌ 错误:", error);
  }
  
  // 测试完成后退出
  setTimeout(() => process.exit(0), 2000);
});

stream.connect().catch(console.error);
