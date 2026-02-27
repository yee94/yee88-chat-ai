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
