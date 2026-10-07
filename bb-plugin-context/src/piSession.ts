import type { CategoryId } from "./contract";
import { contentText, estimateContent, estimateTokens, oneLine, withoutSenderHeader } from "./estimate";
import { attributeMeasured, type CallUsage } from "./measure";

export interface SessionItem {
  key: string;
  category: CategoryId;
  label: string;
  detail: string | null;
  estTokens: number;
  /** Index of the user message this item follows (0-based); null for system, tools, memory, skills. */
  userOrdinal: number | null;
  /** Set on user-message items, for matching to bb turns. */
  userText?: string;
  /** Tokens derived from the provider's per-call usage; absent when only estimated. */
  measuredTokens?: number;
}

export interface SessionCompaction {
  tokensBefore: number | null;
  tokensAfter: number | null;
}

export interface SessionContext {
  items: SessionItem[];
  model: string | null;
  compactedBeforeOrdinal: number | null;
  /** Every compaction recorded in the file, oldest first, with the sizes the provider reported. */
  compactions: SessionCompaction[];
  /** Calls after the first whose input growth did not fit the items appended before them, so those stayed estimates. */
  fallbackSteps: number;
}

/** Line-at-a-time parser; `push` every complete JSONL line in order, `context()` at any point. */
export interface SessionParser {
  push(line: string): void;
  context(): SessionContext;
}

export interface ContextEntry {
  id: string;
  summary: boolean;
  items: SessionItem[];
  call?: CallUsage;
  /** Compactions seen before this entry was added; usage from an earlier epoch measured a context that no longer exists. */
  epoch: number;
}

/** Measured items of the in-context entries, using only calls made since the last compaction. */
export function measuredContext(base: readonly SessionItem[], entries: readonly ContextEntry[], epoch: number) {
  return attributeMeasured(
    base,
    entries.map((entry) => ({ items: entry.items, ...(entry.epoch === epoch && entry.call !== undefined ? { call: entry.call } : {}) })),
  );
}

const asCount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

const DETAIL_MAX = 80;
const COMMAND_MAX = 60;
const PATH_TOOLS = new Set(["read", "edit", "write", "multiedit", "notebookedit"]);
const PATTERN_TOOLS = new Set(["grep", "find", "glob"]);
const FALLBACK_KEYS = ["path", "file_path", "pattern", "command", "url", "query", "description", "skill", "prompt"];

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Short subject of a tool call: the path, the command, or the pattern. */
export function toolSubject(name: string, args: unknown): string | null {
  const input = asRecord(args);
  const tool = name.toLowerCase();
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = asString(input[key]);
      if (value !== null && value.trim() !== "") return value;
    }
    return null;
  };
  let subject: string | null;
  if (PATH_TOOLS.has(tool)) subject = pick("path", "file_path", "notebook_path");
  else if (tool === "bash") subject = pick("command");
  else if (PATTERN_TOOLS.has(tool)) subject = pick("pattern", "glob");
  else subject = pick(...FALLBACK_KEYS);
  if (subject === null) return null;
  return oneLine(subject, tool === "bash" ? COMMAND_MAX : DETAIL_MAX);
}

export function parseJsonLine(line: string): Record<string, unknown> | null {
  if (line.trim() === "") return null;
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** First user ordinal still in context, or the user count when none is. */
export function firstOrdinal(entries: readonly ContextEntry[], users: number): number {
  for (const entry of entries) {
    for (const item of entry.items) {
      if (item.userText !== undefined && item.userOrdinal !== null) return item.userOrdinal;
    }
  }
  return users;
}

const SECTION_CATEGORY: Record<string, CategoryId> = { project_context: "memory", skills: "skills" };

export function createPiSessionParser(): SessionParser {
  const sections = new Map<string, number>();
  const tools = new Map<string, number>();
  const toolCalls = new Map<string, { name: string; subject: string | null }>();
  let entries: ContextEntry[] = [];
  let users = 0;
  let model: string | null = null;
  let compactedBeforeOrdinal: number | null = null;
  const compactions: SessionCompaction[] = [];
  let anonymous = 0;
  let epoch = 0;

  const ordinal = () => (users === 0 ? null : users - 1);

  function callUsage(id: string, message: Record<string, unknown>): CallUsage | undefined {
    if (message.role !== "assistant" || message.usage == null) return undefined;
    const usage = asRecord(message.usage);
    return { id, input: asCount(usage.input) + asCount(usage.cacheRead) + asCount(usage.cacheWrite), output: asCount(usage.output), reasoning: asCount(usage.reasoning) };
  }

  function messageItems(id: string, message: Record<string, unknown>, replacedOrdinal?: number | null): SessionItem[] {
    const role = message.role;
    const content = message.content;
    if (role === "user") {
      if (replacedOrdinal === undefined) users += 1;
      const text = contentText(content);
      return [
        {
          key: `${id}:0`,
          category: "user",
          label: "Message",
          detail: oneLine(withoutSenderHeader(text), DETAIL_MAX),
          estTokens: estimateContent(content),
          userOrdinal: replacedOrdinal === undefined ? ordinal() : replacedOrdinal,
          userText: text,
        },
      ];
    }
    if (role === "assistant") {
      if (typeof message.model === "string") model = message.model;
      if (!Array.isArray(content)) return [];
      const items: SessionItem[] = [];
      content.forEach((raw, index) => {
        const block = asRecord(raw);
        const key = `${id}:${index}`;
        if (block.type === "text" && typeof block.text === "string") {
          items.push({ key, category: "assistant", label: "Reply", detail: oneLine(block.text, DETAIL_MAX), estTokens: estimateTokens(block.text), userOrdinal: ordinal() });
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          if (block.thinking === "") return;
          items.push({ key, category: "thinking", label: "Thinking", detail: oneLine(block.thinking, DETAIL_MAX), estTokens: estimateTokens(block.thinking), userOrdinal: ordinal() });
        } else if (block.type === "toolCall") {
          const name = asString(block.name) ?? "tool";
          const subject = toolSubject(name, block.arguments);
          if (typeof block.id === "string") toolCalls.set(block.id, { name, subject });
          items.push({ key, category: "toolCalls", label: name, detail: subject, estTokens: estimateTokens(name + JSON.stringify(block.arguments ?? {})), userOrdinal: ordinal() });
        }
      });
      return items;
    }
    if (role === "toolResult") {
      const call = typeof message.toolCallId === "string" ? toolCalls.get(message.toolCallId) : undefined;
      const name = asString(message.toolName) ?? call?.name ?? "tool";
      return [{ key: `${id}:0`, category: "toolResults", label: name, detail: call?.subject ?? null, estTokens: estimateContent(content), userOrdinal: ordinal() }];
    }
    if (role === "custom" || role === "bashExecution" || role === "branchSummary") {
      return [{ key: `${id}:0`, category: "other", label: String(message.customType ?? role), detail: null, estTokens: estimateContent(content ?? message.output ?? message.summary), userOrdinal: ordinal() }];
    }
    return [];
  }

  function applySystem(message: Record<string, unknown>) {
    for (const [name, text] of Object.entries(asRecord(message.sections))) {
      if (typeof text === "string") sections.set(name, estimateTokens(text));
    }
    if (typeof message.content === "string" && message.content !== "") sections.set("content", estimateTokens(message.content));
    if (Array.isArray(message.toolsAdded)) {
      for (const raw of message.toolsAdded) {
        const tool = asRecord(raw);
        if (typeof tool.name === "string") tools.set(tool.name, estimateTokens(JSON.stringify(tool)));
      }
    }
    if (Array.isArray(message.toolsRemoved)) {
      for (const name of message.toolsRemoved) if (typeof name === "string") tools.delete(name);
    }
  }

  function push(line: string) {
    const entry = parseJsonLine(line);
    if (entry === null) return;
    const id = asString(entry.id) ?? `anon${anonymous++}`;
    switch (entry.type) {
      case "model_change":
        if (typeof entry.modelId === "string") model = entry.modelId;
        return;
      case "message": {
        const message = asRecord(entry.message);
        if (message.role === "system") return applySystem(message);
        // pi-ai's transformMessages never replays errored or aborted assistant messages.
        if (message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")) return;
        const items = messageItems(id, message);
        const call = callUsage(id, message);
        if (items.length > 0 || call !== undefined) entries.push({ id, summary: false, items, epoch, ...(call !== undefined ? { call } : {}) });
        return;
      }
      case "custom_message": {
        const label = asString(entry.customType) ?? "custom message";
        entries.push({ id, summary: false, epoch, items: [{ key: `${id}:0`, category: "other", label, detail: oneLine(contentText(entry.content), DETAIL_MAX) || null, estTokens: estimateContent(entry.content), userOrdinal: ordinal() }] });
        return;
      }
      case "compaction": {
        const kept = entries.findIndex((candidate) => candidate.id === entry.firstKeptEntryId);
        entries = kept === -1 ? entries.filter((candidate) => !candidate.summary) : entries.slice(kept);
        const summary = asString(entry.summary) ?? "";
        epoch += 1;
        entries.unshift({ id, summary: true, epoch, items: [{ key: `${id}:0`, category: "summary", label: "Compaction summary", detail: null, estTokens: estimateTokens(summary), userOrdinal: ordinal() }] });
        compactedBeforeOrdinal = firstOrdinal(entries, users);
        compactions.push({ tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : null, tokensAfter: null });
        return;
      }
      case "context_edit": {
        const index = entries.findIndex((candidate) => candidate.id === entry.targetId);
        if (index === -1) return;
        const replacement = asRecord(entry.replacement);
        if (typeof replacement.role === "string") {
          const replacedOrdinal = entries[index]?.items[0]?.userOrdinal ?? null;
          entries[index] = { id: String(entry.targetId), summary: false, epoch: entries[index]?.epoch ?? epoch, items: messageItems(String(entry.targetId), replacement, replacedOrdinal) };
        } else {
          entries.splice(index, 1);
        }
        return;
      }
    }
  }

  function context(): SessionContext {
    const base: SessionItem[] = [];
    for (const [name, estTokens] of sections) {
      base.push({ key: `section:${name}`, category: SECTION_CATEGORY[name] ?? "system", label: name, detail: null, estTokens, userOrdinal: null });
    }
    for (const [name, estTokens] of tools) {
      base.push({ key: `tool:${name}`, category: "tools", label: name, detail: null, estTokens, userOrdinal: null });
    }
    const { items, fallbackSteps } = measuredContext(base, entries, epoch);
    return { items, model, compactedBeforeOrdinal, compactions: [...compactions], fallbackSteps };
  }

  return { push, context };
}

export function parsePiSession(text: string): SessionContext {
  const parser = createPiSessionParser();
  for (const line of text.split("\n")) parser.push(line);
  return parser.context();
}
