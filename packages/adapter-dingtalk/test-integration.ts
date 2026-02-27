/**
 * DingTalk 完整集成测试
 * 
 * 使用 Chat SDK 模式：接收消息 -> 自动回复
 */

import { createStreamClient, createDingTalkAdapter } from "./src/index.js";

const config = {
  clientId: "ding5mfchuedme8ij6co",
  clientSecret: "GpOoqTvooj9a0dLijCSukS7GWYns6Ia8Gud-ijaqX7XaiGd_J39SVwGf_ytrJWoI",
  robotCode: "ding5mfchuedme8ij6co",
  corpId: "dingd8e1123006514592",
  agentId: "4213108944",
};

console.log("🚀 DingTalk Chat Adapter 集成测试");
console.log("=".repeat(50));
console.log(`ClientID: ${config.clientId}`);
console.log(`RobotCode: ${config.robotCode}`);
console.log("=".repeat(50));
console.log("");

// 创建适配器
const adapter = createDingTalkAdapter(config);

// 创建 Stream 客户端
const stream = createStreamClient({
  ...config,
  debug: false,
});

// 监听状态
stream.onStateChange((state, error) => {
  console.log(`📡 状态: ${state}${error ? ` (${error})` : ""}`);
});

// 监听消息并自动回复
stream.onMessage(async (message, ack) => {
  console.log("");
  console.log("=".repeat(50));
  console.log("📨 收到消息!");
  console.log(`  发送者: ${message.senderNick} (${message.senderId})`);
  console.log(`  类型: ${message.conversationType === "1" ? "单聊" : "群聊"}`);
  console.log(`  内容: ${message.text?.content ?? `[${message.msgtype}]`}`);
  console.log("=".repeat(50));

  // 确认消息
  ack();

  // 构建 threadId
  const threadId = adapter.encodeThreadId({
    conversationId:
      message.conversationType === "2"
        ? message.conversationId
        : message.senderId,
    conversationType: message.conversationType as "1" | "2",
  });

  // 缓存 session webhook
  if (message.sessionWebhook) {
    (adapter as any).sessionWebhookCache.set(threadId, message.sessionWebhook);
  }

  // 自动回复
  const replyText = `收到你的消息: "${message.text?.content ?? "(非文本)"}"

🤖 这是来自 **@chat-adapter/dingtalk** 的自动回复
⏰ 时间: ${new Date().toLocaleString("zh-CN")}`;

  try {
    console.log("📤 发送回复...");
    const result = await adapter.postMessage(threadId, replyText);
    console.log(`✅ 回复成功! ID: ${result.id}`);
  } catch (error) {
    console.error("❌ 回复失败:", error);
  }
});

// 连接
async function main() {
  console.log("🔌 连接中...");
  await stream.connect();
  console.log("");
  console.log("✅ 已连接! 等待消息...");
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
