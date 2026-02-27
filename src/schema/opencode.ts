// src/schema/opencode.ts - OpenCode CLI JSONL 事件 schema
import { z } from "zod/v4";

const baseFields = {
  timestamp: z.number().nullable().optional(),
  sessionID: z.string().nullable().optional(),
};

const PartSchema = z.record(z.string(), z.unknown()).nullable().optional();

export const StepStartSchema = z.object({
  type: z.literal("step_start"),
  ...baseFields,
  part: PartSchema,
});

export const StepFinishSchema = z.object({
  type: z.literal("step_finish"),
  ...baseFields,
  part: PartSchema,
});

export const ToolUseSchema = z.object({
  type: z.literal("tool_use"),
  ...baseFields,
  part: PartSchema,
});

export const TextSchema = z.object({
  type: z.literal("text"),
  ...baseFields,
  part: PartSchema,
});

export const ErrorSchema = z.object({
  type: z.literal("error"),
  ...baseFields,
  error: z.unknown().optional(),
  message: z.unknown().optional(),
});

export const OpenCodeEventSchema = z.discriminatedUnion("type", [
  StepStartSchema,
  StepFinishSchema,
  ToolUseSchema,
  TextSchema,
  ErrorSchema,
]);

export type StepStart = z.infer<typeof StepStartSchema>;
export type StepFinish = z.infer<typeof StepFinishSchema>;
export type ToolUse = z.infer<typeof ToolUseSchema>;
export type Text = z.infer<typeof TextSchema>;
export type ErrorEvent = z.infer<typeof ErrorSchema>;
export type OpenCodeEvent = z.infer<typeof OpenCodeEventSchema>;

export function decodeEvent(line: string | Uint8Array): OpenCodeEvent {
  const text = typeof line === "string" ? line : new TextDecoder().decode(line);
  const json = JSON.parse(text);
  return OpenCodeEventSchema.parse(json);
}