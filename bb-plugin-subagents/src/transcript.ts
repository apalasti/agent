import type { TranscriptEntry } from "./contract";

const TEXT_LIMIT = 20_000;
const ARGS_LIMIT = 4_000;
const RESULT_LIMIT = 4_000;
const SUMMARY_LIMIT = 400;

/** Path-argument name of each file-mutating tool: pi's `write`/`edit`, and Claude Code's names. */
const FILE_TOOLS: Record<string, { key: string; op: "writes" | "edits" }> = {
  write: { key: "path", op: "writes" },
  edit: { key: "path", op: "edits" },
  Write: { key: "file_path", op: "writes" },
  Edit: { key: "file_path", op: "edits" },
  MultiEdit: { key: "file_path", op: "edits" },
  NotebookEdit: { key: "notebook_path", op: "edits" },
};

export interface FileOp {
  path: string;
  op: "writes" | "edits";
}

export interface NestedLaunch {
  callId: string;
  description: string;
  type: string;
  prompt: string;
  background: boolean | null;
  agentId: string | null;
  /** Text of the nested `Agent` result: the final report for a foreground child. */
  resultText: string | null;
  resultIsError: boolean;
  at: string | null;
}

export interface NestedStatusRef {
  text: string;
  isError: boolean;
}

export interface TranscriptState {
  /** Bytes consumed, always at a line boundary. */
  offset: number;
  agentId: string | null;
  entries: TranscriptEntry[];
  turns: number;
  toolCalls: number;
  model: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  lastStopReason: string | null;
  lastText: string | null;
  nested: NestedLaunch[];
  /** Latest nested `get_subagent_result` reading per child agent id. */
  nestedRefs: Map<string, NestedStatusRef>;
  /** Successful file writes/edits per path as the tool received it (possibly relative). */
  files: Map<string, { writes: number; edits: number }>;
  toolIndex: Map<string, number>;
  pendingFiles: Map<string, FileOp>;
  pendingNested: Map<string, NestedLaunch>;
  pendingRefs: Map<string, string>;
}

export function emptyTranscript(): TranscriptState {
  return {
    offset: 0,
    agentId: null,
    entries: [],
    turns: 0,
    toolCalls: 0,
    model: null,
    startedAt: null,
    updatedAt: null,
    lastActivity: null,
    lastStopReason: null,
    lastText: null,
    nested: [],
    nestedRefs: new Map(),
    files: new Map(),
    toolIndex: new Map(),
    pendingFiles: new Map(),
    pendingNested: new Map(),
    pendingRefs: new Map(),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const firstLine = (text: string) => text.trim().split("\n", 1)[0] ?? "";

const SUMMARY_KEYS: Record<string, string> = {
  bash: "command",
  read: "path",
  edit: "path",
  write: "path",
  ls: "path",
  find: "pattern",
  grep: "pattern",
  Agent: "description",
  get_subagent_result: "agent_id",
  steer_subagent: "agent_id",
};

export function summarizeToolCall(name: string, args: unknown): string {
  const record = isRecord(args) ? args : {};
  const key = SUMMARY_KEYS[name];
  const value =
    (key !== undefined ? str(record[key]) : null) ?? Object.values(record).find((candidate) => typeof candidate === "string");
  return clip(typeof value === "string" ? `${name}: ${firstLine(value)}` : name, SUMMARY_LIMIT);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []))
    .join("\n");
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

const NESTED_BACKGROUND = /^Nested agent started in background\. Agent ID: (\S+)/;

function countFile(state: TranscriptState, { path, op }: FileOp) {
  const counts = state.files.get(path) ?? { writes: 0, edits: 0 };
  counts[op] += 1;
  state.files.set(path, counts);
}

export function fileOp(name: string, args: unknown): FileOp | null {
  const tool = FILE_TOOLS[name];
  const path = tool !== undefined && isRecord(args) ? str(args[tool.key]) : null;
  return tool !== undefined && path !== null && path !== "" ? { path, op: tool.op } : null;
}

function addPrompt(state: TranscriptState, at: string | null, text: string) {
  const previous = state.entries.at(-1);
  if (previous?.kind === "prompt" && previous.text === text) return;
  state.entries.push({ kind: "prompt", at, text: clip(text, TEXT_LIMIT) });
}

function addAssistant(state: TranscriptState, at: string | null, message: Record<string, unknown>) {
  state.turns += 1;
  state.model = str(message.model) ?? state.model;
  state.lastStopReason = str(message.stopReason);
  const content = Array.isArray(message.content) ? message.content : [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      state.entries.push({ kind: "text", at, text: clip(block.text, TEXT_LIMIT) });
      state.lastText = block.text;
      state.lastActivity = clip(firstLine(block.text), SUMMARY_LIMIT);
    } else if (block.type === "toolCall") {
      const name = str(block.name) ?? "tool";
      const callId = str(block.id);
      const summary = summarizeToolCall(name, block.arguments);
      state.toolCalls += 1;
      state.lastActivity = summary;
      if (callId !== null) state.toolIndex.set(callId, state.entries.length);
      state.entries.push({
        kind: "tool",
        at,
        callId,
        name,
        summary,
        args: clip(stringify(block.arguments), ARGS_LIMIT),
        result: null,
        isError: false,
      });
      const file = fileOp(name, block.arguments);
      if (file !== null) {
        if (callId === null) countFile(state, file);
        else state.pendingFiles.set(callId, file);
      }
      const args = isRecord(block.arguments) ? block.arguments : {};
      if (name === "Agent" && callId !== null) {
        const launch: NestedLaunch = {
          callId,
          description: str(args.description) ?? "",
          type: str(args.subagent_type) ?? "general-purpose",
          prompt: str(args.prompt) ?? "",
          background: typeof args.run_in_background === "boolean" ? args.run_in_background : null,
          agentId: null,
          resultText: null,
          resultIsError: false,
          at,
        };
        state.nested.push(launch);
        state.pendingNested.set(callId, launch);
      } else if (name === "get_subagent_result" && callId !== null && typeof args.agent_id === "string") {
        state.pendingRefs.set(callId, args.agent_id);
      }
    }
  }
}

function addToolResult(state: TranscriptState, message: Record<string, unknown>) {
  const callId = str(message.toolCallId);
  const text = contentText(message.content);
  const isError = message.isError === true;
  const index = callId === null ? undefined : state.toolIndex.get(callId);
  const entry = index === undefined ? undefined : state.entries[index];
  if (entry?.kind === "tool") {
    entry.result = clip(text, RESULT_LIMIT);
    entry.isError = isError;
  }
  if (callId === null) return;
  const file = state.pendingFiles.get(callId);
  if (file !== undefined) {
    state.pendingFiles.delete(callId);
    if (!isError) countFile(state, file);
  }
  const launch = state.pendingNested.get(callId);
  if (launch !== undefined) {
    state.pendingNested.delete(callId);
    const background = NESTED_BACKGROUND.exec(text);
    launch.background = background !== null;
    launch.agentId = background?.[1] ?? null;
    launch.resultText = background === null ? text : null;
    launch.resultIsError = isError;
  }
  const refAgent = state.pendingRefs.get(callId);
  if (refAgent !== undefined) {
    state.pendingRefs.delete(callId);
    state.nestedRefs.set(refAgent, { text, isError });
  }
}

function applyLine(state: TranscriptState, line: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(parsed) || !isRecord(parsed.message)) return;
  const at = str(parsed.timestamp);
  state.agentId = state.agentId ?? str(parsed.agentId);
  state.startedAt = state.startedAt ?? at;
  state.updatedAt = at ?? state.updatedAt;
  const message = parsed.message;
  if (message.role === "assistant") addAssistant(state, at, message);
  else if (message.role === "user") addPrompt(state, at, contentText(message.content));
  else if (message.role === "toolResult") addToolResult(state, message);
}

/** Consumes complete lines of `chunk`, which starts at `state.offset`; returns the bytes consumed. */
export function appendTranscript(state: TranscriptState, chunk: Buffer): number {
  const end = chunk.lastIndexOf(0x0a);
  if (end === -1) return 0;
  for (const line of chunk.subarray(0, end).toString("utf8").split("\n")) {
    if (line.trim() !== "") applyLine(state, line);
  }
  state.offset += end + 1;
  return end + 1;
}

export function parseTranscript(text: string): TranscriptState {
  const state = emptyTranscript();
  appendTranscript(state, Buffer.from(text.endsWith("\n") ? text : `${text}\n`, "utf8"));
  return state;
}

/** The prompt an `.output` file was started with: its first line's user content. */
export function transcriptPrompt(firstLineText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(firstLineText);
    if (!isRecord(parsed) || !isRecord(parsed.message) || parsed.message.role !== "user") return null;
    return contentText(parsed.message.content);
  } catch {
    return null;
  }
}

/** The first prompt plus the newest entries, `limit` in total. */
export function tailEntries(entries: readonly TranscriptEntry[], limit: number): { entries: TranscriptEntry[]; truncated: boolean } {
  if (entries.length <= limit) return { entries: [...entries], truncated: false };
  const first = entries[0];
  if (first?.kind === "prompt" && limit > 1) return { entries: [first, ...entries.slice(-(limit - 1))], truncated: true };
  return { entries: entries.slice(-limit), truncated: true };
}
