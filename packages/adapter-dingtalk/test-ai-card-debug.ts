/**
 * AI Card 调试测试 - 打印完整 API 响应
 */

import { getAccessToken } from "./src/auth.js";

const config = {
  clientId: "ding5mfchuedme8ij6co",
  clientSecret: "GpOoqTvooj9a0dLijCSukS7GWYns6Ia8Gud-ijaqX7XaiGd_J39SVwGf_ytrJWoI",
  cardTemplateId: "35813773-9c79-4091-89a1-d6b5cc3547d2.schema",
};

// 测试用的 conversationId (从上次测试获取)
const conversationId = "cidp2lS/Rl9bFQACs4xrPaA5g=="; // 需要替换为实际值

async function testCreateCard() {
  console.log("获取 access token...");
  const token = await getAccessToken(config);
  console.log("Token:", token.slice(0, 20) + "...");

  const cardInstanceId = `card_test_${Date.now()}`;
  const isGroup = conversationId.startsWith("cid");

  const body = {
    cardTemplateId: config.cardTemplateId,
    outTrackId: cardInstanceId,
    cardData: { cardParamMap: {} },
    callbackType: "STREAM",
    imGroupOpenSpaceModel: { supportForward: true },
    imRobotOpenSpaceModel: { supportForward: true },
    openSpaceId: isGroup
      ? `dtv1.card//IM_GROUP.${conversationId}`
      : `dtv1.card//IM_ROBOT.${conversationId}`,
    userIdType: 1,
    imGroupOpenDeliverModel: isGroup ? { robotCode: config.clientId } : undefined,
    imRobotOpenDeliverModel: !isGroup ? { spaceType: "IM_ROBOT" } : undefined,
  };

  console.log("\n请求体:");
  console.log(JSON.stringify(body, null, 2));

  console.log("\n发送创建卡片请求...");
  const response = await fetch("https://api.dingtalk.com/v1.0/card/instances/createAndDeliver", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": token,
    },
    body: JSON.stringify(body),
  });

  console.log("\n响应状态:", response.status, response.statusText);
  const responseText = await response.text();
  console.log("响应内容:", responseText);

  if (response.ok) {
    console.log("\n✅ 卡片创建成功！");
    
    // 尝试流式更新
    console.log("\n发送流式更新...");
    const streamBody = {
      outTrackId: cardInstanceId,
      guid: crypto.randomUUID(),
      key: "content",
      content: "# 测试内容\n\n这是一条测试消息。",
      isFull: true,
      isFinalize: false,
      isError: false,
    };
    console.log("流式更新请求体:", JSON.stringify(streamBody, null, 2));

    const streamResponse = await fetch("https://api.dingtalk.com/v1.0/card/streaming", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
      body: JSON.stringify(streamBody),
    });

    console.log("流式更新响应状态:", streamResponse.status, streamResponse.statusText);
    const streamText = await streamResponse.text();
    console.log("流式更新响应内容:", streamText);
  }
}

testCreateCard().catch(console.error);
