/**
 * DingTalk AI Card streaming support.
 *
 * AI Cards provide the best streaming UX with typewriter effect.
 * Uses DingTalk's standard AI Card template for streaming responses.
 *
 * @see https://open.dingtalk.com/document/development/api-streamingupdate
 * @see https://alidocs.dingtalk.com/i/nodes/qnYMoO1rWxrkmoj2I5zM2GjnJ47Z3je9
 */

import { randomUUID } from "node:crypto";
import type { Logger } from "chat";
import { getAccessToken } from "./auth";
import type { DingTalkAdapterConfig } from "./types";

const DINGTALK_API = "https://api.dingtalk.com";

/**
 * DingTalk's standard AI Card template ID.
 * This template supports: pending (处理中), inputing (输入中), finished (完成), failed (失败) states.
 */
const STANDARD_AI_CARD_TEMPLATE = "1a579f2b-3082-446c-9107-7fd36e2c310c.schema";

/** AI Card status */
export enum AICardStatus {
  PROCESSING = "PROCESSING",
  INPUTING = "INPUTING",
  FINISHED = "FINISHED",
  FAILED = "FAILED",
}

/** AI Card instance */
export interface AICardInstance {
  cardInstanceId: string;
  accessToken: string;
  conversationId: string;
  createdAt: number;
  lastUpdated: number;
  state: AICardStatus;
  config: DingTalkAdapterConfig;
}

/** AI Card streaming request */
interface AICardStreamingRequest {
  outTrackId: string;
  guid: string;
  key: string;
  content: string;
  isFull: boolean;
  isFinalize: boolean;
  isError: boolean;
}

/**
 * AI Card initial data for the standard template.
 */
interface AICardData {
  content: string;
  pending?: { title: string };
  done?: { action_text: string; action_url: string };
  failed?: { image: string; text: string; action_text: string; action_url: string };
}

/**
 * Create and deliver an AI Card.
 *
 * @param config - Adapter configuration
 * @param conversationId - Conversation ID (openConversationId for groups, conversationId for DMs)
 * @param userId - User ID for DM (required for single chat)
 * @param isGroup - Whether this is a group chat
 * @param logger - Optional logger
 */
export async function createAICard(
  config: DingTalkAdapterConfig,
  conversationId: string,
  userId: string | undefined,
  isGroup: boolean,
  logger?: Logger,
): Promise<AICardInstance | null> {
  // Use standard AI Card template or custom template
  const templateId = config.cardTemplateId ?? STANDARD_AI_CARD_TEMPLATE;

  try {
    const token = await getAccessToken(config, logger);
    const cardInstanceId = `card_${randomUUID()}`;

    logger?.debug?.("Creating AI Card", { cardInstanceId, conversationId, userId, isGroup, templateId });

    const robotCode = config.robotCode ?? config.clientId;

    // Build openSpaceId based on chat type
    // For DM: dtv1.card//im_robot.{userId}
    // For Group: dtv1.card//IM_GROUP.{openConversationId}
    let openSpaceId: string;
    if (isGroup) {
      openSpaceId = `dtv1.card//IM_GROUP.${conversationId}`;
    } else {
      // For DM, use userId (not conversationId)
      if (!userId) {
        logger?.warn?.("userId required for DM AI Card");
        return null;
      }
      openSpaceId = `dtv1.card//im_robot.${userId}`;
    }

    // Initial card data for standard AI Card template
    const cardData: AICardData = {
      content: "",
      pending: { title: "思考中" },
      done: { action_text: "内容由 AI 生成", action_url: "https://dingtalk.com" },
      failed: {
        image: "https://static.dingtalk.com/media/lALPDeC2-_4rgFjNAVDNAVA_336_336.png",
        text: "内容生成失败，您可以",
        action_text: "点击重试",
        action_url: "dtmd://dingtalkclient/sendMessage?content=重试",
      },
    };

    const createAndDeliverBody: Record<string, unknown> = {
      cardTemplateId: templateId,
      outTrackId: cardInstanceId,
      openSpaceId,
      userIdType: 1,
      cardData: {
        cardParamMap: {
          content: cardData.content,
          pending: JSON.stringify(cardData.pending),
          done: JSON.stringify(cardData.done),
          failed: JSON.stringify(cardData.failed),
        },
      },
    };

    // Add delivery model based on chat type
    if (isGroup) {
      createAndDeliverBody.imGroupOpenSpaceModel = { supportForward: true };
      createAndDeliverBody.imGroupOpenDeliverModel = { robotCode };
    } else {
      createAndDeliverBody.imRobotOpenSpaceModel = { supportForward: true };
      createAndDeliverBody.imRobotOpenDeliverModel = { spaceType: "IM_ROBOT", robotCode };
    }

    logger?.debug?.("AI Card request body", { body: JSON.stringify(createAndDeliverBody) });

    const response = await fetch(
      `${DINGTALK_API}/v1.0/card/instances/createAndDeliver`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": token,
        },
        body: JSON.stringify(createAndDeliverBody),
      },
    );

    const responseText = await response.text();
    let responseData: Record<string, unknown> = {};
    try {
      responseData = JSON.parse(responseText);
    } catch {
      // ignore parse error
    }

    if (!response.ok) {
      logger?.error?.("Failed to create AI Card", {
        status: response.status,
        error: responseText,
      });
      return null;
    }

    // Check delivery result
    const deliverResults = (responseData.result as Record<string, unknown>)?.deliverResults as Array<{
      success: boolean;
      errorMsg?: string;
    }> | undefined;
    const deliverResult = deliverResults?.[0];
    if (deliverResult && !deliverResult.success) {
      logger?.error?.("AI Card delivery failed", {
        error: deliverResult.errorMsg,
        openSpaceId,
      });
      return null;
    }

    const aiCardInstance: AICardInstance = {
      cardInstanceId,
      accessToken: token,
      conversationId,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      state: AICardStatus.PROCESSING,
      config,
    };

    logger?.info?.("AI Card created", { cardInstanceId });
    return aiCardInstance;
  } catch (error) {
    logger?.error?.("Failed to create AI Card", { error: String(error) });
    return null;
  }
}

/**
 * Stream content to an AI Card.
 */
export async function streamAICard(
  card: AICardInstance,
  content: string,
  finished: boolean = false,
  logger?: Logger,
): Promise<boolean> {
  if (card.state === AICardStatus.FINISHED || card.state === AICardStatus.FAILED) {
    logger?.debug?.("Skipping stream update, card in terminal state", {
      cardInstanceId: card.cardInstanceId,
      state: card.state,
    });
    return false;
  }

  // Refresh token if needed (90 minutes threshold)
  const tokenAge = Date.now() - card.createdAt;
  const tokenRefreshThreshold = 90 * 60 * 1000;

  if (tokenAge > tokenRefreshThreshold) {
    try {
      card.accessToken = await getAccessToken(card.config, logger);
      logger?.debug?.("AI Card token refreshed");
    } catch (error) {
      logger?.warn?.("Failed to refresh AI Card token", { error: String(error) });
    }
  }

  const streamBody: AICardStreamingRequest = {
    outTrackId: card.cardInstanceId,
    guid: randomUUID(),
    key: card.config.cardTemplateKey ?? "content",
    content,
    isFull: true,
    isFinalize: finished,
    isError: false,
  };

  try {
    const response = await fetch(`${DINGTALK_API}/v1.0/card/streaming`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": card.accessToken,
      },
      body: JSON.stringify(streamBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      
      // 500 unknownError usually means cardTemplateKey mismatch
      if (response.status === 500) {
        logger?.error?.(
          "AI Card streaming failed (500). Check cardTemplateKey matches template variable name.",
          { key: streamBody.key, error: errorText },
        );
        card.state = AICardStatus.FAILED;
        return false;
      }

      // Retry once on 401
      if (response.status === 401) {
        logger?.warn?.("AI Card streaming 401, refreshing token and retrying");
        try {
          card.accessToken = await getAccessToken(card.config, logger);
          const retryResponse = await fetch(`${DINGTALK_API}/v1.0/card/streaming`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "x-acs-dingtalk-access-token": card.accessToken,
            },
            body: JSON.stringify({ ...streamBody, guid: randomUUID() }),
          });
          if (!retryResponse.ok) {
            logger?.error?.("AI Card streaming retry failed", {
              status: retryResponse.status,
            });
            return false;
          }
        } catch {
          return false;
        }
      } else {
        logger?.error?.("AI Card streaming failed", {
          status: response.status,
          error: errorText,
        });
        return false;
      }
    }

    card.lastUpdated = Date.now();
    if (finished) {
      card.state = AICardStatus.FINISHED;
    } else if (card.state === AICardStatus.PROCESSING) {
      card.state = AICardStatus.INPUTING;
    }

    return true;
  } catch (error) {
    logger?.error?.("AI Card streaming error", { error: String(error) });
    return false;
  }
}

/**
 * Finalize an AI Card with final content.
 */
export async function finishAICard(
  card: AICardInstance,
  content: string,
  logger?: Logger,
): Promise<boolean> {
  return streamAICard(card, content, true, logger);
}
