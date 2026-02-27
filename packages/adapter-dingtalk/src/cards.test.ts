import { describe, expect, it } from "vitest";
import {
  cardToDingTalkActionCard,
  decodeDingTalkCallbackData,
  encodeDingTalkCallbackData,
} from "./cards";

describe("cardToDingTalkActionCard", () => {
  it("returns undefined when card has no actions", () => {
    const card = cardToDingTalkActionCard(
      {
        type: "card",
        title: "No actions",
        children: [{ type: "text", content: "hi" }],
      },
      "hello",
    );

    expect(card).toBeUndefined();
  });

  it("converts actions to DingTalk ActionCard buttons", () => {
    const card = cardToDingTalkActionCard(
      {
        type: "card",
        children: [
          {
            type: "actions",
            children: [
              { type: "button", id: "approve", label: "同意", value: "yes" },
              { type: "button", id: "reject", label: "拒绝", value: "no" },
            ],
          },
        ],
      },
      "请审批",
    );

    expect(card).toBeDefined();
    expect(card!.title).toBe("请审批");
    expect(card!.btns).toHaveLength(2);
    expect(card!.btns[0]!.title).toBe("同意");
    expect(card!.btns[1]!.title).toBe("拒绝");
    // Horizontal layout for <= 2 buttons.
    expect(card!.btnOrientation).toBe("1");
  });

  it("uses vertical layout for more than 2 buttons", () => {
    const card = cardToDingTalkActionCard(
      {
        type: "card",
        children: [
          {
            type: "actions",
            children: [
              { type: "button", id: "a", label: "A" },
              { type: "button", id: "b", label: "B" },
              { type: "button", id: "c", label: "C" },
            ],
          },
        ],
      },
      "选择",
    );

    expect(card!.btnOrientation).toBe("0");
  });

  it("converts link-buttons to direct URLs", () => {
    const card = cardToDingTalkActionCard(
      {
        type: "card",
        children: [
          {
            type: "actions",
            children: [
              {
                type: "link-button",
                label: "查看文档",
                url: "https://example.com",
              },
            ],
          },
        ],
      },
      "链接",
    );

    expect(card!.btns[0]!.title).toBe("查看文档");
    expect(card!.btns[0]!.actionURL).toBe("https://example.com");
  });

  it("collects buttons from nested sections", () => {
    const card = cardToDingTalkActionCard(
      {
        type: "card",
        children: [
          {
            type: "section",
            children: [
              {
                type: "actions",
                children: [
                  { type: "button", id: "nested", label: "嵌套按钮" },
                ],
              },
            ],
          },
        ],
      },
      "嵌套",
    );

    expect(card!.btns).toHaveLength(1);
    expect(card!.btns[0]!.title).toBe("嵌套按钮");
  });

  it("ignores unsupported action controls", () => {
    const card = cardToDingTalkActionCard(
      {
        type: "card",
        children: [
          {
            type: "actions",
            children: [
              {
                type: "select",
                id: "priority",
                label: "Priority",
                options: [{ label: "High", value: "high" }],
              },
            ],
          },
        ],
      } as never,
      "选择",
    );

    expect(card).toBeUndefined();
  });
});

describe("callback payload encoding", () => {
  it("encodes and decodes callback payload with value", () => {
    const encoded = encodeDingTalkCallbackData("approve", "request-123");
    const decoded = decodeDingTalkCallbackData(encoded);

    expect(decoded).toEqual({
      actionId: "approve",
      value: "request-123",
    });
  });

  it("encodes and decodes callback payload without value", () => {
    const encoded = encodeDingTalkCallbackData("click");
    const decoded = decodeDingTalkCallbackData(encoded);

    expect(decoded).toEqual({
      actionId: "click",
      value: undefined,
    });
  });

  it("decodes empty callback payload with dingtalk_callback fallback", () => {
    const decoded = decodeDingTalkCallbackData(undefined);
    expect(decoded).toEqual({
      actionId: "dingtalk_callback",
      value: undefined,
    });
  });

  it("falls back to raw payload for malformed encoded data", () => {
    const decoded = decodeDingTalkCallbackData("chat:{not-json");
    expect(decoded).toEqual({
      actionId: "chat:{not-json",
      value: "chat:{not-json",
    });
  });

  it("falls back to raw payload for non-encoded callbacks", () => {
    const decoded = decodeDingTalkCallbackData("legacy_action");
    expect(decoded).toEqual({
      actionId: "legacy_action",
      value: "legacy_action",
    });
  });
});
