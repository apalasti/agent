import type { CategoryId } from "./contract";
import { contentText, estimateContent, estimateTokens, oneLine, withoutSenderHeader } from "./estimate";
import type { CallUsage } from "./measure";
import {
  firstOrdinal,
  measuredContext,
  parseJsonLine,
  toolSubject,
  type ContextEntry,
  type SessionCompaction,
  type SessionContext,
  type SessionItem,
  type SessionParser,
} from "./piSession";

const DETAIL_MAX = 80;
const SKIPPED_TYPES = new Set(["queue-operation", "last-prompt", "ai-title", "atis-latch"]);
const ATTACHMENT_CATEGORY: Record<string, CategoryId> = { instructions: "memory", skill_listing: "skills" };
const COMMAND_PREFIXES = ["<command-name>", "<local-command-", "<command-message>"];

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asCount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** One API response is written as one line per content block, each repeating the response's usage. */
function callUsage(message: Record<string, unknown>): CallUsage | undefined {
  if (typeof message.id !== "string" || message.usage == null) return undefined;
  const usage = asRecord(message.usage);
  const input = asCount(usage.input_tokens) + asCount(usage.cache_creation_input_tokens) + asCount(usage.cache_read_input_tokens);
  if (input === 0) return undefined;
  return { id: message.id, input, output: asCount(usage.output_tokens), reasoning: 0 };
}

function renderedTokens(rendered: unknown): number {
  if (!Array.isArray(rendered)) return estimateContent(rendered);
  let total = 0;
  for (const part of rendered) {
    const record = asRecord(part);
    total += "content" in record ? estimateContent(record.content) : estimateContent([part]);
  }
  return total;
}

function isPrompt(entry: Record<string, unknown>, text: string): boolean {
  if (entry.isMeta === true || entry.isCompactSummary === true || text.trim() === "") return false;
  const start = text.trimStart();
  return !COMMAND_PREFIXES.some((prefix) => start.startsWith(prefix));
}

export function createClaudeTranscriptParser(): SessionParser {
  const toolUses = new Map<string, { name: string; subject: string | null }>();
  let systemItems: SessionItem[] = [];
  let entries: ContextEntry[] = [];
  let users = 0;
  let model: string | null = null;
  let compactedBeforeOrdinal: number | null = null;
  const compactions: SessionCompaction[] = [];
  let anonymous = 0;
  let epoch = 0;

  const ordinal = () => (users === 0 ? null : users - 1);

  function userItems(id: string, entry: Record<string, unknown>, content: unknown): SessionItem[] {
    if (entry.isCompactSummary === true) {
      return [{ key: `${id}:0`, category: "summary", label: "Compaction summary", detail: null, estTokens: estimateContent(content), userOrdinal: ordinal() }];
    }
    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    const items: SessionItem[] = [];
    const promptBlocks: unknown[] = [];
    blocks.forEach((raw, index) => {
      const block = asRecord(raw);
      if (block.type === "tool_result") {
        const use = typeof block.tool_use_id === "string" ? toolUses.get(block.tool_use_id) : undefined;
        items.push({ key: `${id}:${index}`, category: "toolResults", label: use?.name ?? "tool", detail: use?.subject ?? null, estTokens: estimateContent(block.content), userOrdinal: ordinal() });
      } else {
        promptBlocks.push(raw);
      }
    });
    if (promptBlocks.length === 0) return items;
    const text = contentText(promptBlocks);
    const prompt = isPrompt(entry, text);
    if (prompt) users += 1;
    items.push({
      key: `${id}:text`,
      category: prompt ? "user" : "other",
      label: prompt ? "Message" : "Command",
      detail: oneLine(withoutSenderHeader(text), DETAIL_MAX) || null,
      estTokens: estimateContent(promptBlocks),
      userOrdinal: ordinal(),
      ...(prompt ? { userText: text } : {}),
    });
    return items;
  }

  function assistantItems(id: string, message: Record<string, unknown>): SessionItem[] {
    if (typeof message.model === "string" && !message.model.startsWith("<")) model = message.model;
    const content = Array.isArray(message.content) ? message.content : [];
    const items: SessionItem[] = [];
    content.forEach((raw, index) => {
      const block = asRecord(raw);
      const key = `${id}:${index}`;
      if (block.type === "text" && typeof block.text === "string") {
        items.push({ key, category: "assistant", label: "Reply", detail: oneLine(block.text, DETAIL_MAX), estTokens: estimateTokens(block.text), userOrdinal: ordinal() });
      } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking !== "") {
        items.push({ key, category: "thinking", label: "Thinking", detail: oneLine(block.thinking, DETAIL_MAX), estTokens: estimateTokens(block.thinking), userOrdinal: ordinal() });
      } else if (block.type === "tool_use") {
        const name = typeof block.name === "string" ? block.name : "tool";
        const subject = toolSubject(name, block.input);
        if (typeof block.id === "string") toolUses.set(block.id, { name, subject });
        items.push({ key, category: "toolCalls", label: name, detail: subject, estTokens: estimateTokens(name + JSON.stringify(block.input ?? {})), userOrdinal: ordinal() });
      }
    });
    return items;
  }

  function promptSnapshot(attachment: Record<string, unknown>) {
    const items: SessionItem[] = [];
    const system = [attachment.cliPrefix, ...(Array.isArray(attachment.systemPrompt) ? attachment.systemPrompt : [])]
      .filter((part): part is string => typeof part === "string")
      .join("\n");
    if (system !== "") items.push({ key: "system:prompt", category: "system", label: "System prompt", detail: null, estTokens: estimateTokens(system), userOrdinal: null });
    if (Array.isArray(attachment.tools)) {
      for (const raw of attachment.tools) {
        const tool = asRecord(raw);
        const name = typeof tool.name === "string" ? tool.name : "tool";
        items.push({ key: `tool:${name}`, category: "tools", label: name, detail: null, estTokens: estimateTokens(JSON.stringify(raw)), userOrdinal: null });
      }
    }
    if (items.length > 0) systemItems = items;
  }

  function push(line: string) {
    const entry = parseJsonLine(line);
    if (entry === null || entry.isSidechain === true || SKIPPED_TYPES.has(String(entry.type))) return;
    const id = typeof entry.uuid === "string" ? entry.uuid : `anon${anonymous++}`;
    const message = asRecord(entry.message);
    switch (entry.type) {
      case "user": {
        const items = userItems(id, entry, message.content);
        if (items.length > 0) entries.push({ id, summary: entry.isCompactSummary === true, items, epoch });
        return;
      }
      case "assistant": {
        const items = assistantItems(id, message);
        const call = callUsage(message);
        if (items.length > 0 || call !== undefined) entries.push({ id, summary: false, items, epoch, ...(call !== undefined ? { call } : {}) });
        return;
      }
      case "attachment": {
        const attachment = asRecord(entry.attachment);
        const kind = typeof attachment.type === "string" ? attachment.type : "attachment";
        if (kind === "prompt_snapshot") return promptSnapshot(attachment);
        if (entry.rendered == null) return;
        const category = ATTACHMENT_CATEGORY[kind] ?? "other";
        entries.push({ id, summary: false, epoch, items: [{ key: `${id}:0`, category, label: attachmentLabel(kind), detail: null, estTokens: renderedTokens(entry.rendered), userOrdinal: category === "other" ? ordinal() : null }] });
        return;
      }
      case "system": {
        if (entry.subtype !== "compact_boundary") return;
        const metadata = asRecord(entry.compactMetadata);
        const preserved = asRecord(metadata.preservedMessages).allUuids;
        compactions.push({
          tokensBefore: typeof metadata.preTokens === "number" ? metadata.preTokens : null,
          tokensAfter: typeof metadata.postTokens === "number" ? metadata.postTokens : null,
        });
        const keep = new Set(Array.isArray(preserved) ? preserved.filter((uuid): uuid is string => typeof uuid === "string") : []);
        entries = entries.filter((candidate) => keep.has(candidate.id));
        epoch += 1;
        compactedBeforeOrdinal = firstOrdinal(entries, users);
        return;
      }
    }
  }

  function context(): SessionContext {
    const { items, fallbackSteps } = measuredContext(systemItems, entries, epoch);
    return { items, model, compactedBeforeOrdinal, compactions: [...compactions], fallbackSteps };
  }

  return { push, context };
}

/** `mcp_instructions_delta` → "MCP instructions (update)". */
export function attachmentLabel(kind: string): string {
  const update = kind.endsWith("_delta");
  const words = kind.replace(/_delta$/, "").split("_").filter(Boolean).map((word) => (word === "mcp" ? "MCP" : word));
  const label = words.join(" ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}${update ? " (update)" : ""}`;
}

export function parseClaudeTranscript(text: string): SessionContext {
  const parser = createClaudeTranscriptParser();
  for (const line of text.split("\n")) parser.push(line);
  return parser.context();
}
