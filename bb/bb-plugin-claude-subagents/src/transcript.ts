import type { FileChange, Step } from "./contract";
import { firstLine } from "./text";

export type Transcript = {
  prompt: string;
  steps: Step[];
  toolUseIds: Set<string>;
  report: string | null;
  handedBack: boolean;
  files: FileChange[];
  model: string | null;
  context: number;
  peakContext: number;
  firstAt: number | null;
  lastAt: number | null;
  endedTurn: boolean;
};

type Block = { type: string; [key: string]: unknown };
type Usage = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
type Line = {
  type?: string;
  isSidechain?: boolean;
  timestamp?: string;
  message?: { model?: string; content?: string | Block[]; usage?: Usage; stop_reason?: string | null };
  toolUseResult?: unknown;
};
type Hunk = { lines?: string[] };

const CLIP = 4_000;
const SUMMARY_CLIP = 200;
const FALLBACK_SUMMARY_CLIP = 120;
const STANDARD_WINDOW = 200_000;
const LARGE_WINDOW = 1_000_000;

const clip = (text: string, max = CLIP) => (text.length > max ? `${text.slice(0, max)}…` : text);
const isPrompt = (text: unknown): text is string => typeof text === "string" && text !== "" && !text.startsWith("<");
const lineCount = (text: unknown) => (typeof text === "string" && text.length > 0 ? text.split("\n").length : 0);

export function contextWindow(model: string | null, peak: number): number {
  return model?.includes("[1m]") || peak > STANDARD_WINDOW ? LARGE_WINDOW : STANDARD_WINDOW;
}

export function summarizeTool(name: string, input: Record<string, unknown>): string {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  switch (name) {
    case "Bash":
      return str("description") || firstLine(str("command").replace(/^cd [^;&]+(;|&&)\s*/, ""));
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
      return str("file_path");
    case "Grep":
    case "Glob":
      return str("path") ? `${str("pattern")} in ${str("path")}` : str("pattern");
    case "Agent":
    case "Task":
      return str("description");
    case "SubagentHandback":
      return "report back";
    case "WebFetch":
      return str("url");
    case "WebSearch":
      return str("query");
    default:
      return clip(JSON.stringify(input), FALLBACK_SUMMARY_CLIP);
  }
}

function countHunks(hunks: unknown): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  if (!Array.isArray(hunks)) return { added, removed };
  for (const hunk of hunks as Hunk[])
    for (const line of hunk.lines ?? []) {
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  return { added, removed };
}

function changesFromResult(toolUseResult: unknown): FileChange[] {
  if (typeof toolUseResult !== "object" || toolUseResult === null) return [];
  const result = toolUseResult as Record<string, unknown>;
  const changes: FileChange[] = [];
  if (typeof result.filePath === "string" && (Array.isArray(result.structuredPatch) || result.type === "create")) {
    const counted = countHunks(result.structuredPatch);
    if (result.type === "create" && counted.added === 0) counted.added = lineCount(result.content);
    changes.push({ path: result.filePath, ...counted });
  }
  const bash = result.bashEditDiff as { files?: { filePath: string; hunks: unknown }[] } | undefined;
  for (const file of bash?.files ?? []) changes.push({ path: file.filePath, ...countHunks(file.hunks) });
  return changes;
}

function changesFromInput(tool: string, input: Record<string, unknown>): FileChange[] {
  const path = input.file_path;
  if (typeof path !== "string") return [];
  if (tool === "Write") return [{ path, added: lineCount(input.content), removed: 0 }];
  if (tool === "Edit") return [{ path, added: lineCount(input.new_string), removed: lineCount(input.old_string) }];
  if (tool === "MultiEdit" && Array.isArray(input.edits))
    return (input.edits as Record<string, unknown>[]).map((edit) => ({
      path,
      added: lineCount(edit.new_string),
      removed: lineCount(edit.old_string),
    }));
  return [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : "")).join("\n");
}

const contextOf = (usage: Usage) =>
  (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);

function parseLine(raw: string): Line | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as Line;
  } catch {
    return null;
  }
}

export function parseTranscript(jsonl: string, opts: { sidechain: boolean }): Transcript {
  const steps: Step[] = [];
  const pending = new Map<string, { step: Step; input: Record<string, unknown> }>();
  const files = new Map<string, FileChange>();
  let prompt = "";
  let handback: string | null = null;
  let lastText: string | null = null;
  let model: string | null = null;
  let context = 0;
  let peakContext = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  let endedTurn = false;

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
    if (!line || (line.isSidechain && !opts.sidechain)) continue;
    const parsedAt = line.timestamp ? Date.parse(line.timestamp) : NaN;
    const at = Number.isNaN(parsedAt) ? null : parsedAt;
    if (at !== null) {
      firstAt ??= at;
      lastAt = at;
    }
    const content = line.message?.content;

    if (line.type === "user") {
      if (typeof content === "string") {
        if (!prompt && isPrompt(content)) prompt = content;
        continue;
      }
      for (const block of content ?? []) {
        if (block.type === "text" && !prompt && isPrompt(block.text)) prompt = block.text;
        if (block.type !== "tool_result") continue;
        const call = pending.get(String(block.tool_use_id));
        if (!call) continue;
        call.step.result = clip(resultText(block.content));
        call.step.isError = block.is_error === true;
        call.step.endAt = at;
        if (call.step.isError) continue;
        const fromResult = changesFromResult(line.toolUseResult);
        addChanges(fromResult.length > 0 ? fromResult : changesFromInput(call.step.name, call.input));
      }
      continue;
    }

    if (line.type !== "assistant" || !line.message || !Array.isArray(content)) continue;
    const message = line.message;
    if (message.model && !message.model.startsWith("<")) model = message.model;
    if (message.usage) {
      context = contextOf(message.usage);
      peakContext = Math.max(peakContext, context);
    }
    endedTurn = message.stop_reason === "end_turn";
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        lastText = block.text;
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
      if (block.type !== "tool_use") continue;
      const name = String(block.name);
      const input = (block.input ?? {}) as Record<string, unknown>;
      const step: Step = {
        at: at ?? 0,
        endAt: null,
        kind: "tool",
        name,
        summary: summarizeTool(name, input),
        input: clip(JSON.stringify(input, null, 2)),
        result: null,
        isError: false,
      };
      steps.push(step);
      pending.set(String(block.id), { step, input });
      if (name === "SubagentHandback" && typeof input.message === "string") handback = input.message;
    }
  }

  return {
    prompt,
    steps,
    toolUseIds: new Set(pending.keys()),
    report: handback ?? (opts.sidechain ? lastText : null),
    handedBack: steps.filter((step) => step.kind === "tool").at(-1)?.name === "SubagentHandback",
    files: [...files.values()],
    model,
    context,
    peakContext,
    firstAt,
    lastAt,
    endedTurn,
  };
}
