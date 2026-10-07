import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseClaudeTranscript } from "../src/claudeTranscript";
import { composeReport } from "../src/compose";
import type { ContextReport } from "../src/contract";
import { parseTimeline } from "../src/events";
import { parsePiSession, type SessionItem } from "../src/piSession";

const line = (value: unknown) => JSON.stringify(value);
const text = (chars: number, fill = "x") => fill.repeat(chars);
const usage = (input: number, output: number, reasoning = 0) => ({ input: 2, cacheRead: input - 2, cacheWrite: 0, output, totalTokens: input + output, reasoning });

const system = line({
  type: "message",
  id: "sys",
  message: { role: "system", sections: { preamble: text(4000), project_context: text(2000) }, toolsAdded: [{ name: "bash", description: text(3900) }] },
});
const user = (id: string, chars: number) => line({ type: "message", id, message: { role: "user", content: [{ type: "text", text: text(chars) }] } });
const assistant = (id: string, input: number, output: number, reasoning = 0, call = `call_${id}`) =>
  line({
    type: "message",
    id,
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: text(200) },
        { type: "text", text: text(200) },
        { type: "toolCall", id: call, name: "bash", arguments: { command: `run ${id}` } },
      ],
      usage: usage(input, output, reasoning),
    },
  });
const result = (id: string, call: string, chars: number) =>
  line({ type: "message", id, message: { role: "toolResult", toolCallId: call, toolName: "bash", content: [{ type: "text", text: text(chars) }] } });

const byKey = (items: readonly SessionItem[], key: string) => items.find((item) => item.key === key);
const sumOf = (items: readonly SessionItem[], keep: (item: SessionItem) => boolean) =>
  items.filter(keep).reduce((sum, item) => sum + (item.measuredTokens ?? item.estTokens), 0);

describe("measured attribution", () => {
  it("gives each step's input growth to the items appended before it and each call's output to its blocks", () => {
    const session = parsePiSession(
      [system, user("u1", 400), assistant("a1", 3_000, 500, 120), result("r1", "call_a1", 8_000), result("r2", "call_a1", 4_000), assistant("a2", 6_500, 300)].join("\n"),
    );
    const { items } = session;
    expect(session.fallbackSteps).toBe(0);
    expect(sumOf(items, (item) => item.userOrdinal === null || item.category === "user")).toBe(3_000);
    expect(byKey(items, "a1:0")?.measuredTokens).toBe(120);
    expect((byKey(items, "a1:1")?.measuredTokens ?? 0) + (byKey(items, "a1:2")?.measuredTokens ?? 0)).toBe(380);
    // a2's input grew by 6500 - 3000 - 500 = 3000, split 2:1 like the results' estimates.
    expect(byKey(items, "r1:0")?.measuredTokens).toBe(2_000);
    expect(byKey(items, "r2:0")?.measuredTokens).toBe(1_000);
    expect(sumOf(items, (item) => item.key.startsWith("a2:"))).toBe(300);
    expect(sumOf(items, () => true)).toBe(6_500 + 300);
  });

  it("leaves a step at its estimates when the input shrank", () => {
    const session = parsePiSession([system, user("u1", 400), assistant("a1", 3_000, 500), result("r1", "call_a1", 8_000), assistant("a2", 2_000, 300)].join("\n"));
    expect(session.fallbackSteps).toBe(1);
    expect(byKey(session.items, "r1:0")?.measuredTokens).toBeUndefined();
    expect(byKey(session.items, "r1:0")?.estTokens).toBe(2_000);
    expect(byKey(session.items, "a2:1")?.measuredTokens).toBeDefined();
  });

  it("skips errored and aborted replies, which pi never sends back", () => {
    const aborted = line({ type: "message", id: "x1", message: { role: "assistant", stopReason: "aborted", content: [{ type: "text", text: text(4000) }], usage: usage(0, 0) } });
    const session = parsePiSession([system, user("u1", 400), assistant("a1", 3_000, 500), result("r1", "call_a1", 800), aborted, assistant("a2", 3_700, 100)].join("\n"));
    expect(session.fallbackSteps).toBe(0);
    expect(session.items.some((item) => item.key.startsWith("x1:"))).toBe(false);
    expect(byKey(session.items, "r1:0")?.measuredTokens).toBe(200);
  });

  it("falls back when the growth is far from the estimate, but tolerates the framing around tiny results", () => {
    const far = parsePiSession([system, user("u1", 400), assistant("a1", 3_000, 500), result("r1", "call_a1", 400), assistant("a2", 3_500 + 900, 300)].join("\n"));
    expect(far.fallbackSteps).toBe(1);
    const tiny = parsePiSession([system, user("u1", 400), assistant("a1", 3_000, 500), result("r1", "call_a1", 8), assistant("a2", 3_500 + 34, 300)].join("\n"));
    expect(tiny.fallbackSteps).toBe(0);
    expect(byKey(tiny.items, "r1:0")?.measuredTokens).toBe(34);
  });

  it("ignores usage from before a compaction and starts a new baseline after it", () => {
    const compaction = line({ type: "compaction", id: "c1", summary: text(1200), firstKeptEntryId: "r1", tokensBefore: 90_000 });
    const session = parsePiSession(
      [system, user("u1", 400), assistant("a1", 3_000, 500), result("r1", "call_a1", 800), compaction, user("u2", 400), assistant("a2", 4_200, 100)].join("\n"),
    );
    expect(session.fallbackSteps).toBe(0);
    expect(byKey(session.items, "a1:0")).toBeUndefined();
    expect(sumOf(session.items, (item) => !item.key.startsWith("a2:"))).toBe(4_200);
    expect(byKey(session.items, "c1:0")?.measuredTokens).toBeGreaterThan(0);
  });

  it("counts a Claude Code response once although each content block repeats its usage", () => {
    const message = (block: unknown, output: number) => ({
      id: "msg_1",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [block],
      usage: { input_tokens: 10, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 2_000, output_tokens: output },
    });
    const transcript = [
      line({ type: "user", uuid: "u1", message: { role: "user", content: text(2_000) } }),
      line({ type: "assistant", uuid: "a1", message: message({ type: "text", text: text(400) }, 1) }),
      line({ type: "assistant", uuid: "a2", message: message({ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }, 240) }),
      line({ type: "user", uuid: "r1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: text(4_000) }] } }),
      line({ type: "assistant", uuid: "a3", message: { ...message({ type: "text", text: text(40) }, 5), id: "msg_2", usage: { input_tokens: 4_250, output_tokens: 5 } } }),
    ].join("\n");
    const session = parseClaudeTranscript(transcript);
    expect(session.fallbackSteps).toBe(0);
    expect(byKey(session.items, "u1:text")?.measuredTokens).toBeUndefined();
    expect(sumOf(session.items, (item) => item.key.startsWith("a1:") || item.key.startsWith("a2:"))).toBe(240);
    expect(byKey(session.items, "r1:0")?.measuredTokens).toBe(4_250 - 3_010 - 240);
  });
});

const LEAD = "/tmp/ctxui/fixtures/pi-lead-session.jsonl";

describe.skipIf(!existsSync(LEAD))("measured attribution on the lead's 1.6 MB session", () => {
  const raw = existsSync(LEAD) ? readFileSync(LEAD, "utf8") : "";
  const entries = raw
    .split("\n")
    .filter(Boolean)
    .map((value) => JSON.parse(value) as { type: string; message?: { role: string; usage?: { input: number; cacheRead: number; cacheWrite: number; output: number } } });
  const calls = entries.flatMap((entry) => (entry.message?.role === "assistant" && entry.message.usage ? [entry.message.usage] : []));
  const inputOf = (call: (typeof calls)[number]) => call.input + call.cacheRead + call.cacheWrite;
  const last = calls.at(-1);
  const T = last === undefined ? 0 : inputOf(last) + last.output;
  const outputs = calls.reduce((sum, call) => sum + call.output, 0);

  it("matches the first call, the outputs and the input growth instead of scaling everything", () => {
    const report: ContextReport = composeReport({
      threadId: "thr_lead",
      providerId: "pi",
      threadStatus: "idle",
      timeline: parseTimeline([]),
      session: parsePiSession(raw),
      source: { kind: "pi-session", path: LEAD },
      usage: { usedTokens: T, modelContextWindow: 1_000_000 },
    });
    const tokens = (...ids: string[]) => report.categories.filter((category) => ids.includes(category.id)).reduce((sum, category) => sum + category.tokens, 0);
    const input1 = inputOf(calls[0] as (typeof calls)[number]);
    expect(tokens("system", "tools", "memory", "skills") + tokens("user")).toBe(input1);
    expect(tokens("system", "tools", "memory", "skills")).toBeGreaterThan(16_000);
    expect(tokens("system", "tools", "memory", "skills")).toBeLessThan(19_000);
    expect(tokens("thinking", "assistant", "toolCalls")).toBe(outputs);
    expect(tokens("toolResults")).toBe(T - input1 - outputs);
    expect(Math.abs(tokens(...report.categories.filter((category) => category.kind === "used").map((category) => category.id)) - T)).toBeLessThan(T * 0.01);
    expect(report.notes).toEqual([]);
  });
});
