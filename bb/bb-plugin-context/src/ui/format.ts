import type { CategoryId, ContextWindow, Segment } from "../contract";

function trimmed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "");
}

/** 999 → "999", 4_120 → "4.1k", 27_183 → "27k", 1_250_000 → "1.3m". */
export function formatTokens(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs < 1_000) return `${sign}${Math.round(abs)}`;
  if (abs < 9_950) return `${sign}${trimmed(abs / 1_000, 1)}k`;
  if (abs < 999_500) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${trimmed(abs / 1_000_000, 1)}m`;
}

export function percent(n: number, total: number | null): string | null {
  if (total === null || total <= 0) return null;
  const value = (n / total) * 100;
  if (value > 0 && value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

export type Tone = "muted" | "warn" | "danger";

export const WARN_AT = 0.6;
export const DANGER_AT = 0.85;

export function toneFor(used: number | null, limit: number | null): Tone {
  if (used === null || limit === null || limit <= 0) return "muted";
  const ratio = used / limit;
  if (ratio >= DANGER_AT) return "danger";
  if (ratio >= WARN_AT) return "warn";
  return "muted";
}

export const TONE_TEXT: Record<Tone, string> = {
  muted: "text-muted-foreground",
  warn: "text-warning-text",
  danger: "text-destructive-text",
};

/** Bars fill against the usable limit: autocompact fires before the window is full. */
export function usableLimit(window: Pick<ContextWindow, "autoCompactAt" | "contextWindow">): number | null {
  return window.autoCompactAt ?? window.contextWindow;
}

export const CATEGORY_FILL: Record<CategoryId, string> = {
  system: "bg-foreground/70",
  tools: "bg-foreground/45",
  memory: "bg-pr-merged/50",
  skills: "bg-pr-merged",
  user: "bg-success",
  assistant: "bg-attention",
  thinking: "bg-attention/50",
  toolCalls: "bg-file-accent/50",
  toolResults: "bg-file-accent",
  summary: "bg-success/50",
  other: "bg-foreground/25",
  unattributed: "bg-foreground/25",
  reserved: "bg-warning/50",
  free: "bg-muted",
  deferred: "bg-foreground/25",
};

export function usedTotal(window: ContextWindow, segments: readonly Segment[]): number {
  return window.usedTokens ?? segments.filter((s) => s.id !== "reserved").reduce((sum, s) => sum + s.tokens, 0);
}

/** `27k / 200k · 14%`, with a leading `≈` when the plugin estimated the total. */
export function usageLabel(window: ContextWindow, used: number): string {
  const approx = window.basis === "estimated" ? "≈" : "";
  const parts = [`${approx}${formatTokens(used)}`];
  if (window.contextWindow !== null) parts.push(` / ${formatTokens(window.contextWindow)}`);
  const share = percent(used, window.contextWindow);
  return share === null ? parts.join("") : `${parts.join("")} · ${share}`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const BUSY = new Set(["active", "starting", "stopping", "pending"]);

export function isBusy(threadStatus: string): boolean {
  return BUSY.has(threadStatus);
}
