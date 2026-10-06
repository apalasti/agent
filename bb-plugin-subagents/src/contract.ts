import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const SUBAGENTS_CHANGED = "subagents-changed";

export const subagentStatusSchema = z.enum(["running", "completed", "failed", "stopped", "unknown"]);
export type SubagentStatus = z.infer<typeof subagentStatusSchema>;

export const transcriptEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prompt"), at: z.string().nullable(), text: z.string() }),
  z.object({ kind: z.literal("text"), at: z.string().nullable(), text: z.string() }),
  z.object({
    kind: z.literal("tool"),
    at: z.string().nullable(),
    callId: z.string().nullable(),
    name: z.string(),
    summary: z.string(),
    args: z.string(),
    result: z.string().nullable(),
    isError: z.boolean(),
  }),
]);
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

export const fileTouchSchema = z.object({
  path: z.string(),
  writes: z.number().int(),
  edits: z.number().int(),
});
export type FileTouch = z.infer<typeof fileTouchSchema>;

export const threadEnvironmentSchema = z.object({
  id: z.string(),
  hostId: z.string().nullable(),
  path: z.string(),
});
export type ThreadEnvironment = z.infer<typeof threadEnvironmentSchema>;

export const subagentSchema = z.object({
  agentId: z.string().nullable(),
  callId: z.string(),
  description: z.string(),
  type: z.string(),
  model: z.string().nullable(),
  background: z.boolean(),
  status: subagentStatusSchema,
  startedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  turns: z.number().int(),
  toolCalls: z.number().int(),
  lastActivity: z.string().nullable(),
  result: z.string().nullable(),
  outputFile: z.string().nullable(),
  parentAgentId: z.string().nullable(),
  /** Successful write/edit calls per file, absolute paths, in first-touch order. */
  filesTouched: z.array(fileTouchSchema),
});
export type Subagent = z.infer<typeof subagentSchema>;

export const threadSummarySchema = z.object({
  threadId: z.string(),
  running: z.number().int(),
  total: z.number().int(),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

export const rpcContract = defineRpcContract({
  threadSubagents: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({
      threadId: z.string(),
      subagents: z.array(subagentSchema),
      environment: threadEnvironmentSchema.nullable(),
    }),
  },
  transcript: {
    input: z.object({
      threadId: z.string().min(1),
      callId: z.string().min(1),
      limit: z.number().int().min(1).max(2000).default(400),
    }),
    output: z.object({
      entries: z.array(transcriptEntrySchema),
      truncated: z.boolean(),
      children: z.array(subagentSchema),
    }),
  },
  summaries: {
    input: z.object({ threadIds: z.array(z.string()).max(200).optional() }),
    output: z.object({ threads: z.array(threadSummarySchema) }),
  },
});
