import type { SessionItem } from "./piSession";

/** One LLM call's provider-reported usage; `input` includes cache reads and writes. */
export interface CallUsage {
  id: string;
  input: number;
  output: number;
  /** Reasoning share of `output`, when the provider reports it. */
  reasoning: number;
}

export interface MeasuredEntry {
  items: SessionItem[];
  /** Set on assistant entries whose usage counts for the current context. */
  call?: CallUsage;
}

const MAX_RATIO = 3;
/** Per-message framing the provider adds around each item; dominates tiny tool results. */
const FRAMING_TOKENS = 40;

/** Integers proportional to `weights` that sum exactly to `target` (largest remainder). */
export function apportion(weights: readonly number[], target: number): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0 || target <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (weight * target) / total);
  const result = exact.map(Math.floor);
  let remaining = target - result.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (remaining <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    remaining -= 1;
  }
  return result;
}

function assign(items: SessionItem[], tokens: number) {
  const shares = apportion(
    items.map((item) => item.estTokens),
    tokens,
  );
  items.forEach((item, index) => {
    item.measuredTokens = shares[index] ?? 0;
  });
}

const estimateOf = (items: readonly SessionItem[]) => items.reduce((sum, item) => sum + item.estTokens, 0);

interface Call {
  usage: CallUsage;
  /** Items appended since the previous call. */
  before: SessionItem[];
  produced: SessionItem[];
}

function assignOutput({ usage, produced }: Call) {
  const thinking = produced.filter((item) => item.category === "thinking");
  const rest = produced.filter((item) => item.category !== "thinking");
  if (usage.reasoning > 0 && thinking.length > 0 && rest.length > 0) {
    const reasoning = Math.min(usage.reasoning, usage.output);
    assign(thinking, reasoning);
    assign(rest, usage.output - reasoning);
  } else {
    assign(produced, usage.output);
  }
}

/** Copies of `base` and the entries' items with `measuredTokens` set from per-call usage (DESIGN.md "Measured attribution comes first"). */
export function attributeMeasured(base: readonly SessionItem[], entries: readonly MeasuredEntry[]): { items: SessionItem[]; fallbackSteps: number } {
  const items: SessionItem[] = [];
  const copy = (source: readonly SessionItem[]) =>
    source.map((item) => {
      const fresh: SessionItem = { ...item };
      delete fresh.measuredTokens;
      items.push(fresh);
      return fresh;
    });

  const calls: Call[] = [];
  let pending = copy(base);
  for (const entry of entries) {
    const usage = entry.call;
    const last = calls.at(-1);
    if (usage === undefined) {
      pending.push(...copy(entry.items));
    } else if (last !== undefined && last.usage.id === usage.id) {
      last.usage = { ...usage, output: Math.max(last.usage.output, usage.output), reasoning: Math.max(last.usage.reasoning, usage.reasoning) };
      last.produced.push(...copy(entry.items));
    } else {
      calls.push({ usage, before: pending, produced: copy(entry.items) });
      pending = [];
    }
  }

  let fallbackSteps = 0;
  let previous: CallUsage | null = null;
  for (const call of calls) {
    const grown = previous === null ? call.usage.input : call.usage.input - previous.input - previous.output;
    if (call.before.length > 0) {
      const estimate = estimateOf(call.before);
      const ceiling = estimate * MAX_RATIO + FRAMING_TOKENS * call.before.length;
      if (grown >= 0 && estimate > 0 && grown <= ceiling && grown * MAX_RATIO >= estimate) assign(call.before, grown);
      else if (previous !== null) fallbackSteps += 1;
    }
    assignOutput(call);
    previous = call.usage;
  }
  return { items, fallbackSteps };
}
