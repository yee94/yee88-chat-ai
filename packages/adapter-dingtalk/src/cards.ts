/**
 * DingTalk card conversion utilities.
 *
 * Converts Chat SDK Card elements to DingTalk ActionCard format
 * and handles callback data encoding/decoding.
 */

import { convertEmojiPlaceholders } from "chat";
import type { ActionsElement, CardChild, CardElement } from "chat";

const CALLBACK_DATA_PREFIX = "chat:";

interface DingTalkCardActionPayload {
  a: string;
  v?: string;
}

/**
 * DingTalk ActionCard button.
 */
export interface DingTalkActionCardButton {
  title: string;
  actionURL: string;
}

/**
 * DingTalk ActionCard structure.
 */
export interface DingTalkActionCard {
  title: string;
  text: string;
  btnOrientation: "0" | "1";
  btns: DingTalkActionCardButton[];
}

function convertLabel(label: string): string {
  return convertEmojiPlaceholders(label, "gchat");
}

function toActionCardButtons(
  actions: ActionsElement,
): DingTalkActionCardButton[] {
  const buttons: DingTalkActionCardButton[] = [];

  for (const action of actions.children) {
    if (action.type === "button") {
      buttons.push({
        title: convertLabel(action.label),
        actionURL: `dtmd://dingtalkclient/sendMessage?content=${encodeURIComponent(
          encodeDingTalkCallbackData(action.id, action.value),
        )}`,
      });
      continue;
    }

    if (action.type === "link-button") {
      buttons.push({
        title: convertLabel(action.label),
        actionURL: action.url,
      });
    }
  }

  return buttons;
}

function collectButtons(
  children: CardChild[],
  buttons: DingTalkActionCardButton[],
): void {
  for (const child of children) {
    if (child.type === "actions") {
      const row = toActionCardButtons(child);
      buttons.push(...row);
      continue;
    }

    if (child.type === "section") {
      collectButtons(child.children, buttons);
    }
  }
}

/**
 * Convert a Chat SDK Card element to a DingTalk ActionCard.
 * Returns undefined if the card has no actionable buttons.
 */
export function cardToDingTalkActionCard(
  card: CardElement,
  fallbackText: string,
): DingTalkActionCard | undefined {
  const buttons: DingTalkActionCardButton[] = [];
  collectButtons(card.children, buttons);

  if (buttons.length === 0) {
    return undefined;
  }

  return {
    title: fallbackText.slice(0, 20) || "消息",
    text: fallbackText,
    btnOrientation: buttons.length <= 2 ? "1" : "0",
    btns: buttons,
  };
}

/**
 * Encode action data for DingTalk callback.
 */
export function encodeDingTalkCallbackData(
  actionId: string,
  value?: string,
): string {
  const payload: DingTalkCardActionPayload = { a: actionId };
  if (typeof value === "string") {
    payload.v = value;
  }
  return `${CALLBACK_DATA_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * Decode DingTalk callback data.
 */
export function decodeDingTalkCallbackData(data?: string): {
  actionId: string;
  value: string | undefined;
} {
  if (!data) {
    return { actionId: "dingtalk_callback", value: undefined };
  }

  if (!data.startsWith(CALLBACK_DATA_PREFIX)) {
    return { actionId: data, value: data };
  }

  try {
    const decoded = JSON.parse(
      data.slice(CALLBACK_DATA_PREFIX.length),
    ) as DingTalkCardActionPayload;

    if (typeof decoded.a === "string" && decoded.a) {
      return {
        actionId: decoded.a,
        value: typeof decoded.v === "string" ? decoded.v : undefined,
      };
    }
  } catch {
    // Fall back to legacy passthrough behavior.
  }

  return { actionId: data, value: data };
}
