/**
 * DingTalk 流式响应集成测试
 * 
 * 自动降级策略：
 * 1. 主动消息 API + 撤回 (如果 staffId 可用且 IP 白名单配置正确)
 * 2. Session Webhook (无法撤回，会产生多条消息)
 */

import { createStreamClient, createDingTalkAdapter } from "./src/index.js";

const config = {
  clientId: "ding5mfchuedme8ij6co",
  clientSecret: "GpOoqTvooj9a0dLijCSukS7GWYns6Ia8Gud-ijaqX7XaiGd_J39SVwGf_ytrJWoI",
  robotCode: "ding5mfchuedme8ij6co",
  corpId: "dingd8e1123006514592",
  agentId: "4213108944",
};

console.log("🚀 DingTalk 流式响应测试 (自动降级)");
console.log("=".repeat(50));
console.log("降级策略:");
console.log("  1. 主动消息 API + 撤回 (最佳)");
console.log("  2. Session Webhook (降级，会有多条消息)");
console.log("=".repeat(50));
console.log("");

const adapter = createDingTalkAdapter(config);

const stream = createStreamClient({
  ...config,
  debug: false,
});

stream.onStateChange((state, error) => {
  console.log(`📡 状态: ${state}${error ? ` (${error})` : ""}`);
});

stream.onMessage(async (message, ack) => {
  console.log("");
  console.log("=".repeat(50));
  console.log(`📨 收到: "${message.text?.content ?? message.msgtype}"`);
  console.log(`   发送者: ${message.senderNick} (staffId: ${message.senderStaffId})`);
  console.log("=".repeat(50));

  ack();

  const threadId = adapter.encodeThreadId({
    conversationId: message.conversationId,
    conversationType: message.conversationType as "1" | "2",
  });

  // 模拟 handleIncomingMessage 的行为：缓存 staffId 和 sessionWebhook
  if (message.conversationType === "1" && message.senderStaffId) {
    (adapter as any).staffIdCache.set(threadId, message.senderStaffId);
  }
  if (message.sessionWebhook) {
    (adapter as any).sessionWebhookCache.set(threadId, message.sessionWebhook);
  }

  try {
    // Step 1: 发送初始消息 "思考中..."
    console.log("📤 Step 1: 发送初始消息...");
    const initialResult = await adapter.postMessage(threadId, "🤔 思考中...");
    console.log(`✅ 初始消息已发送, ID: ${initialResult.id}`);
    
    // 检查是否使用了主动消息 API (有 processQueryKey)
    const hasProcessQueryKey = (adapter as any).processQueryKeyCache.has(initialResult.id);
    console.log(`📌 发送方式: ${hasProcessQueryKey ? "主动消息 API (支持撤回)" : "Session Webhook (无法撤回)"}`);

    // Step 2: 模拟流式处理 (等待 3 秒)
    console.log("⏳ Step 2: 模拟处理中... (3秒)");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Step 3: 编辑消息为最终结果
    const finalText = `✅ 处理完成！

你发送的消息是: "${message.text?.content ?? "(非文本)"}"

---
🤖 **流式响应测试**
⏰ 时间: ${new Date().toLocaleString("zh-CN")}
📝 ${hasProcessQueryKey ? "原消息已撤回" : "注意：这是新消息，原消息无法撤回"}`;

    console.log("📤 Step 3: 编辑消息...");
    const editResult = await adapter.editMessage(
      threadId,
      initialResult.id,
      finalText,
    );
    console.log(`✅ 消息已更新, 新ID: ${editResult.id}`);

  } catch (error) {
    console.error("❌ 错误:", error);
  }
});

async function main() {
  console.log("🔌 连接中...");
  await stream.connect();
  console.log("");
  console.log("✅ 已连接!");
  console.log("💡 请在钉钉中 @机器人 发送消息");
  console.log("💡 按 Ctrl+C 退出");
  console.log("");
}

process.on("SIGINT", async () => {
  console.log("\n🛑 断开连接...");
  await stream.disconnect();
  process.exit(0);
});

main().catch((err) => {
  console.error("❌ 启动失败:", err);
  process.exit(1);
});
