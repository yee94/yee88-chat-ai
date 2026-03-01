/**
 * DingTalk format conversion.
 *
 * DingTalk supports a subset of Markdown in its message cards and
 * markdown message type. This converter handles the translation
 * between Chat SDK's AST format and DingTalk-compatible markdown.
 */

import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";

/**
 * 钉钉 Markdown 换行规范化。
 * 钉钉消费标准 Markdown，单个 \n 不会换行，必须 \n\n 才能换行。
 * 将所有孤立的 \n 替换为 \n\n，已有的连续 \n\n 保持不变。
 */
export function normalizeNewlines(text: string): string {
  // 匹配前后都不是 \n 的单独 \n，替换为 \n\n
  return text.replace(/(?<!\n)\n(?!\n)/g, "\n\n");
}

export class DingTalkFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast).trim();
  }

  toAst(text: string): Root {
    return parseMarkdown(text);
  }

  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return message;
    }
    if ("raw" in message) {
      return message.raw;
    }
    if ("markdown" in message) {
      return this.fromMarkdown(message.markdown);
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    return super.renderPostable(message);
  }
}