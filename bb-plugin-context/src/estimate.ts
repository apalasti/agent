export const IMAGE_TOKENS = 1600;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate for a content value that is a string or an array of text/image blocks. */
export function estimateContent(content: unknown): number {
  if (typeof content === "string") return estimateTokens(content);
  if (!Array.isArray(content)) return content == null ? 0 : estimateTokens(JSON.stringify(content));
  let total = 0;
  for (const block of content) {
    if (typeof block === "string") total += estimateTokens(block);
    else if (block !== null && typeof block === "object") {
      const record = block as Record<string, unknown>;
      if (record.type === "image") total += IMAGE_TOKENS;
      else if (typeof record.text === "string") total += estimateTokens(record.text);
      else if (record.type === "tool_result" || record.type === "tool_reference") total += estimateContent(record.content);
      else total += estimateTokens(JSON.stringify(record));
    }
  }
  return total;
}

export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block !== null && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function oneLine(text: string, max: number): string {
  return clip(text.replace(/\s+/g, " ").trim(), max);
}

const SENDER_HEADER = /^\[bb message from [^\]]*\]/;

export function withoutSenderHeader(text: string): string {
  return text.replace(/^\s*/, "").replace(SENDER_HEADER, "").trim();
}

/** Matching key for a user message: whitespace-collapsed prefix after bb's sender header, which is the same for every message from one thread. */
export function messageKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(SENDER_HEADER, "").trim().slice(0, 80);
}
