import { basename } from "node:path";
import type { FileChange, Step } from "./contract";
import { firstLine } from "./text";
import { parseMeta } from "./workflow";

export type PiTranscript = {
  sessionId: string | null;
  parentSession: string | null;
  name: string | null;
  cwd: string | null;
  prompt: string;
  steps: Step[];
  report: string | null;
  files: FileChange[];
  model: string | null;
  context: number;
  peakContext: number;
  totalTokens: number;
  firstAt: number | null;
  lastAt: number | null;
  endedTurn: boolean;
};

type Args = Record<string, unknown>;
type Block = { type?: string; text?: string; id?: string; name?: string; arguments?: Args };
type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
type Message = {
  role?: string;
  content?: string | Block[];
  provider?: string;
  model?: string;
  usage?: Usage;
  stopReason?: string;
  toolCallId?: string;
  isError?: boolean;
};
type Line = {
  type?: string;
  timestamp?: string;
  id?: string;
  cwd?: string;
  parentSession?: string;
  name?: string;
  provider?: string;
  modelId?: string;
  message?: Message;
};

const CLIP = 4_000;
const SUMMARY_CLIP = 200;
const FALLBACK_SUMMARY_CLIP = 120;
const STANDARD_WINDOW = 200_000;
const LARGE_WINDOW = 1_000_000;

const clip = (text: string, max = CLIP) => (text.length > max ? `${text.slice(0, max)}…` : text);
const lineCount = (text: unknown) => (typeof text === "string" && text.length > 0 ? text.split("\n").length : 0);
const modelOf = (provider: string | undefined, model: string | undefined) =>
  model ? (provider ? `${provider}/${model}` : model) : null;

export function contextWindow(model: string | null, peak: number, hint?: string | null): number {
  return hint?.endsWith("1m") || model?.includes("[1m]") || peak > STANDARD_WINDOW ? LARGE_WINDOW : STANDARD_WINDOW;
}

export function summarizeTool(name: string, args: Args): string {
  const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");
  switch (name) {
    case "bash":
      return firstLine(str("command").replace(/^cd [^;&]+(;|&&)\s*/, ""));
    case "read":
    case "edit":
    case "write":
    case "ls":
      return str("path");
    case "grep":
    case "find":
      return str("path") ? `${str("pattern")} in ${str("path")}` : str("pattern");
    case "Agent":
      return str("description");
    case "SubagentWorkflow":
      return parseMeta(str("script")).name ?? (str("scriptPath") ? basename(str("scriptPath")) : "workflow");
    case "get_subagent_result":
    case "steer_subagent":
      return str("agent_id");
    default:
      return clip(JSON.stringify(args), FALLBACK_SUMMARY_CLIP);
  }
}

export function changesFromArgs(tool: string, args: Args): FileChange[] {
  const path = args.path;
  if (typeof path !== "string") return [];
  if (tool === "write") return [{ path, added: lineCount(args.content), removed: 0 }];
  if (tool !== "edit") return [];
  const edits = Array.isArray(args.edits) ? (args.edits as Args[]) : [args];
  const added = edits.reduce((sum, edit) => sum + lineCount(edit.newText), 0);
  const removed = edits.reduce((sum, edit) => sum + lineCount(edit.oldText), 0);
  return [{ path, added, removed }];
}

function resultText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((part) => (typeof part.text === "string" ? part.text : "")).join("\n");
}

function parseLine(raw: string): Line | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as Line;
  } catch {
    return null;
  }
}

/** Parses a pi session file, or a pi-subagents `.output` file (the same messages without the `type:"message"` wrapper). */
export function parsePiSession(jsonl: string): PiTranscript {
  const steps: Step[] = [];
  const pending = new Map<string, { step: Step; args: Args }>();
  const files = new Map<string, FileChange>();
  const out: PiTranscript = {
    sessionId: null,
    parentSession: null,
    name: null,
    cwd: null,
    prompt: "",
    steps,
    report: null,
    files: [],
    model: null,
    context: 0,
    peakContext: 0,
    totalTokens: 0,
    firstAt: null,
    lastAt: null,
    endedTurn: false,
  };

  const addChanges = (changes: FileChange[]) => {
    for (const change of changes) {
      const total = files.get(change.path) ?? { path: change.path, added: 0, removed: 0 };
      total.added += change.added;
      total.removed += change.removed;
      files.set(change.path, total);
    }
  };

  for (const raw of jsonl.split("\n")) {
    const line = parseLine(raw);
    if (!line) continue;
    const parsedAt = line.timestamp ? Date.parse(line.timestamp) : NaN;
    const at = Number.isNaN(parsedAt) ? null : parsedAt;
    if (at !== null) {
      out.firstAt ??= at;
      out.lastAt = at;
    }

    if (line.type === "session") {
      out.sessionId = line.id ?? null;
      out.cwd = line.cwd ?? null;
      out.parentSession = line.parentSession ?? null;
      continue;
    }
    if (line.type === "session_info") {
      out.name = line.name ?? out.name;
      continue;
    }
    if (line.type === "model_change") {
      out.model = modelOf(line.provider, line.modelId) ?? out.model;
      continue;
    }

    const message = line.message;
    if (!message) continue;
    const content = message.content;

    if (message.role === "user") {
      const text = typeof content === "string" ? content : content?.find((block) => block.type === "text")?.text;
      if (!out.prompt && text) out.prompt = text;
      continue;
    }

    if (message.role === "toolResult") {
      const call = pending.get(String(message.toolCallId));
      if (!call) continue;
      call.step.result = clip(resultText(content));
      call.step.isError = message.isError === true;
      call.step.endAt = at;
      if (!call.step.isError) addChanges(changesFromArgs(call.step.name, call.args));
      continue;
    }

    if (message.role !== "assistant") continue;
    out.model = modelOf(message.provider, message.model) ?? out.model;
    if (message.usage) {
      const { input = 0, output = 0, cacheRead = 0, cacheWrite = 0 } = message.usage;
      out.context = input + cacheRead + cacheWrite;
      out.peakContext = Math.max(out.peakContext, out.context);
      out.totalTokens += input + output + cacheWrite;
    }
    out.endedTurn = message.stopReason === "stop";
    for (const block of Array.isArray(content) ? content : []) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        out.report = block.text;
        steps.push({
          at: at ?? 0,
          endAt: at,
          kind: "text",
          name: "text",
          summary: clip(firstLine(block.text), SUMMARY_CLIP),
          input: clip(block.text),
          result: null,
          isError: false,
        });
      }
      if (block.type !== "toolCall") continue;
      const name = String(block.name);
      const args = block.arguments ?? {};
      const step: Step = {
        at: at ?? 0,
        endAt: null,
        kind: "tool",
        name,
        summary: summarizeTool(name, args),
        input: clip(JSON.stringify(args, null, 2)),
        result: null,
        isError: false,
      };
      steps.push(step);
      pending.set(String(block.id), { step, args });
    }
  }

  out.files = [...files.values()];
  return out;
}
