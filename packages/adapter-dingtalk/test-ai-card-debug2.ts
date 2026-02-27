/**
 * AI Card 调试测试 - 测试不同的 openSpaceId 格式
 */

import { getAccessToken } from "./src/auth.js";

const config = {
  clientId: "ding5mfchuedme8ij6co",
  clientSecret: "GpOoqTvooj9a0dLijCSukS7GWYns6Ia8Gud-ijaqX7XaiGd_J39SVwGf_ytrJWoI",
  cardTemplateId: "35813773-9c79-4091-89a1-d6b5cc3547d2.schema",
};

// 从日志中获取的 conversationId
const rawConversationId = "cidp2lS/Rl9bFQACs4xrPaA5g==";

async function testCreateCard(conversationId: string, label: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`测试: ${label}`);
  console.log(`conversationId: ${conversationId}`);
  console.log("=".repeat(60));

  const token = await getAccessToken(config);
  const cardInstanceId = `card_test_${Date.now()}`;
  const isGroup = conversationId.startsWith("cid");

  // 尝试不同的 openSpaceId 格式
  const openSpaceId = isGroup
    ? `dtv1.card//IM_GROUP.${conversationId}`
    : `dtv1.card//IM_ROBOT.${conversationId}`;

  console.log(`openSpaceId: ${openSpaceId}`);

  const body = {
    cardTemplateId: config.cardTemplateId,
    outTrackId: cardInstanceId,
    cardData: { cardParamMap: {} },
    callbackType: "STREAM",
    imGroupOpenSpaceModel: { supportForward: true },
    imRobotOpenSpaceModel: { supportForward: true },
    openSpaceId,
    userIdType: 1,
    imGroupOpenDeliverModel: isGroup ? { robotCode: config.clientId } : undefined,
    imRobotOpenDeliverModel: !isGroup ? { spaceType: "IM_ROBOT" } : undefined,
  };

  const response = await fetch("https://api.dingtalk.com/v1.0/card/instances/createAndDeliver", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": token,
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  console.log("响应:", JSON.stringify(result, null, 2));
  
  const deliverResult = result.result?.deliverResults?.[0];
  if (deliverResult?.success) {
    console.log("✅ 成功!");
  } else {
    console.log("❌ 失败:", deliverResult?.errorMsg);
  }
}

async function main() {
  // 测试原始 conversationId
  await testCreateCard(rawConversationId, "原始 conversationId");
  
  // 测试 URL 编码
  await testCreateCard(encodeURIComponent(rawConversationId), "URL 编码");
  
  // 测试 Base64 解码后的值（如果是 base64）
  try {
    const decoded = atob(rawConversationId.replace("cid", ""));
    console.log("\nBase64 解码结果:", decoded);
  } catch (e) {
    console.log("\n不是有效的 Base64");
  }
}

main().catch(console.error);
