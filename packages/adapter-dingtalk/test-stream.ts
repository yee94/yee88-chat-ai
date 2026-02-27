/**
 * DingTalk Stream 集成测试
 * 
 * 运行: npx tsx test-stream.ts
 */

import { createStreamClient, createDingTalkAdapter, TOPIC_ROBOT } from "./src/index";

const config = {
  clientId: "ding5mfchuedme8ij6co",
  clientSecret: "GpOoqTvooj9a0dLijCSukS7GWYns6Ia8Gud-ijaqX7XaiGd_J39SVwGf_ytrJWoI",
  robotCode: "ding5mfchuedme8ij6co",
  corpId: "dingd8e1123006514592",
  agentId: "4213108944",
};

console.log("🚀 启动 DingTalk Stream 集成测试...\n");
console.log("配置信息:");
console.log(`  ClientID: ${config.clientId}`);
console.log(`  RobotCode: ${config.robotCode}`);
console.log(`  CorpId: ${config.corpId}`);
console.log(`  AgentId: ${config.agentId}`);
console.log("");

// 创建适配器
const adapter = createDingTalkAdapter(config);

// 创建 Stream 客户端
const stream = createStreamClient(
  {
    ...config,
    debug: true,
  },
  {
    info: (msg, data) => console.log(`[INFO] ${msg}`, data ?? ""),
    warn: (msg, data) => console.warn(`[WARN] ${msg}`, data ?? ""),
    error: (msg, data) => console.error(`[ERROR] ${msg}`, data ?? ""),
    debug: (msg, data) => console.log(`[DEBUG] ${msg}`, data ?? ""),
  },
);

// 监听状态变化
stream.onStateChange((state, error) => {
  console.log(`\n📡 Stream 状态: ${state}${error ? ` (${error})` : ""}`);
});

// 监听消息
stream.onMessage(async (message, ack) => {
  console.log("\n" + "=".repeat(60));
  console.log("📨 收到消息!");
  console.log("=".repeat(60));
  console.log(`  消息ID: ${message.msgId}`);
  console.log(`  消息类型: ${message.msgtype}`);
  console.log(`  发送者: ${message.senderNick} (${message.senderId})`);
  console.log(`  会话类型: ${message.conversationType === "1" ? "单聊" : "群聊"}`);
  console.log(`  会话ID: ${message.conversationId}`);
  
  if (message.text?.content) {
    console.log(`  文本内容: ${message.text.content}`);
  }
  
  if (message.content?.richText) {
    console.log(`  富文本: ${JSON.stringify(message.content.richText)}`);
  }
  
  console.log(`  Session Webhook: ${message.sessionWebhook ? "有" : "无"}`);
  console.log("=".repeat(60));
  
  // 确认消息
  ack();
  console.log("✅ 消息已确认\n");
  
  // 尝试回复消息
  if (message.sessionWebhook) {
    try {
      console.log("📤 尝试回复消息...");
      const threadId = adapter.encodeThreadId({
        conversationId: message.conversationType === "2" 
          ? message.conversationId 
          : message.senderId,
        conversationType: message.conversationType as "1" | "2",
      });
      
      // 缓存 session webhook (模拟 webhook 处理流程)
      (adapter as any).sessionWebhookCache.set(threadId, message.sessionWebhook);
      
      const result = await adapter.postMessage(
        threadId,
        `收到你的消息: "${message.text?.content ?? "(非文本消息)"}"`,
      );
      console.log("✅ 回复成功:", result.id);
    } catch (error) {
      console.error("❌ 回复失败:", error);
    }
  }
});

// 监听原始消息 (调试用)
stream.onRawMessage((msg) => {
  if (msg.type !== "SYSTEM") {
    console.log(`[RAW] Topic: ${msg.headers.topic}, Type: ${msg.type}`);
  }
});

// 连接
async function main() {
  try {
    console.log("\n🔌 正在连接 DingTalk Stream...\n");
    await stream.connect();
    console.log("\n✅ 连接成功! 等待消息中...");
    console.log("💡 请在钉钉中 @机器人 发送消息进行测试");
    console.log("💡 按 Ctrl+C 退出\n");
  } catch (error) {
    console.error("\n❌ 连接失败:", error);
    process.exit(1);
  }
}

// 优雅退出
process.on("SIGINT", async () => {
  console.log("\n\n🛑 正在断开连接...");
  await stream.disconnect();
  console.log("👋 再见!");
  process.exit(0);
});

main();
