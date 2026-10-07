import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const CONTEXT_CHANGED = "context-changed";
export const contextChangedSchema = z.object({ threadId: z.string() });

export const categoryIdSchema = z.enum([
  "system",
  "tools",
  "memory",
  "skills",
  "user",
  "assistant",
  "thinking",
  "toolCalls",
  "toolResults",
  "summary",
  "other",
  "unattributed",
  "reserved",
  "free",
  "deferred",
]);
export type CategoryId = z.infer<typeof categoryIdSchema>;
/** Display order for bars and lists. */
export const CATEGORY_ORDER: readonly CategoryId[] = categoryIdSchema.options;

export const categoryKindSchema = z.enum(["used", "reserved", "free", "deferred"]);
export type CategoryKind = z.infer<typeof categoryKindSchema>;

export const entrySchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Secondary text, e.g. the file path or command of a tool result. */
  detail: z.string().nullable(),
  tokens: z.number().int(),
  /** 1-based turn index the item belongs to; null for system, tools, memory, skills. */
  turnIndex: z.number().int().nullable(),
});
export type Entry = z.infer<typeof entrySchema>;

export const categorySchema = z.object({
  id: categoryIdSchema,
  label: z.string(),
  kind: categoryKindSchema,
  tokens: z.number().int(),
  /** Largest first, at most 50. For toolResults: one entry per tool name, with `children`. */
  entries: z.array(
    entrySchema.extend({
      /** Largest individual items under this entry, at most 10. */
      children: z.array(entrySchema),
    }),
  ),
});
export type Category = z.infer<typeof categorySchema>;

export const windowSchema = z.object({
  usedTokens: z.number().int().nullable(),
  contextWindow: z.number().int().nullable(),
  autoCompactAt: z.number().int().nullable(),
  model: z.string().nullable(),
  /** When bb measured `usedTokens`; null when estimated or absent. */
  measuredAt: z.string().nullable(),
  basis: z.enum(["measured", "estimated", "none"]),
  /** A course change happened and the new session has no measurement yet. */
  recomputing: z.boolean(),
});
export type ContextWindow = z.infer<typeof windowSchema>;

export const segmentSchema = z.object({ id: categoryIdSchema, label: z.string(), tokens: z.number().int() });
export type Segment = z.infer<typeof segmentSchema>;

export const meterSchema = z.object({
  threadId: z.string(),
  providerId: z.string().nullable(),
  threadStatus: z.string(),
  window: windowSchema,
  /** Used and reserved categories with tokens > 0, in CATEGORY_ORDER. */
  segments: z.array(segmentSchema),
  /** Largest used categories, at most 3, largest first. */
  top: z.array(segmentSchema),
});
export type Meter = z.infer<typeof meterSchema>;

export const turnSchema = z.object({
  /** 1-based position in the active timeline. */
  index: z.number().int(),
  /** `client/turn/requested` seq; `threads.editMessage` expectedRequestSequence. */
  requestSeq: z.number().int(),
  /** Last event seq of the turn; `threads.fork` sourceSeqEnd. */
  lastSeq: z.number().int(),
  at: z.string(),
  preview: z.string(),
  /** Message text for the edit editor, at most 8000 chars. */
  text: z.string(),
  textTruncated: z.boolean(),
  state: z.enum(["inContext", "summarized", "cleared"]),
  /** Context just before this message was added; what an edit from here rewinds to. */
  tokensBefore: z.number().int().nullable(),
  tokensAfter: z.number().int().nullable(),
  /** tokensAfter came from bb usage events rather than estimation. */
  measured: z.boolean(),
  /** Largest items this turn added, at most 3. */
  largest: z.array(entrySchema),
  editable: z.boolean(),
  /** Why `editable` is false, for the tooltip; null or absent when editable. */
  notEditableReason: z.string().nullable().optional(),
  running: z.boolean(),
});
export type Turn = z.infer<typeof turnSchema>;

export const courseChangeSchema = z.object({
  kind: z.enum(["edited", "compacted", "compactionSkipped", "cleared", "forked"]),
  seq: z.number().int(),
  at: z.string(),
  /** Render the divider before the turn with this index; turns.length + 1 for "at the end". */
  beforeTurnIndex: z.number().int(),
  tokensBefore: z.number().int().nullable(),
  tokensAfter: z.number().int().nullable(),
  discardedTurns: z.number().int().nullable(),
  sourceThreadId: z.string().nullable(),
});
export type CourseChange = z.infer<typeof courseChangeSchema>;

export const reportSchema = meterSchema.extend({
  categories: z.array(categorySchema),
  /** Largest individual in-context items, at most 10. */
  largest: z.array(entrySchema.extend({ categoryId: categoryIdSchema })),
  turns: z.array(turnSchema),
  courseChanges: z.array(courseChangeSchema),
  source: z.object({
    kind: z.enum(["pi-session", "claude-transcript", "claude-snapshot", "bb-only"]),
    path: z.string().nullable(),
    /** Factor estimates were scaled by; null when not scaled. */
    calibration: z.number().nullable(),
  }),
  /** Short user-facing caveats, e.g. "Breakdown estimated from the pi session". */
  notes: z.array(z.string()),
});
export type ContextReport = z.infer<typeof reportSchema>;

const threadInput = z.object({ threadId: z.string().min(1) });

export const rpcContract = defineRpcContract({
  meter: { input: threadInput, output: meterSchema },
  report: { input: threadInput, output: reportSchema },
});
