import { createStreamClient } from "./src/index.js";

const config = {
  clientId: "ding5mfchuedme8ij6co",
  clientSecret: "GpOoqTvooj9a0dLijCSukS7GWYns6Ia8Gud-ijaqX7XaiGd_J39SVwGf_ytrJWoI",
};

const stream = createStreamClient({ ...config, debug: false });

stream.onMessage(async (message, ack) => {
  console.log("=== 收到消息 ===");
  console.log("senderId:", message.senderId);
  console.log("senderStaffId:", message.senderStaffId);
  console.log("conversationId:", message.conversationId);
  console.log("conversationType:", message.conversationType);
  console.log("chatbotUserId:", message.chatbotUserId);
  console.log("================");
  ack();
});

stream.connect().then(() => console.log("已连接，等待消息..."));
