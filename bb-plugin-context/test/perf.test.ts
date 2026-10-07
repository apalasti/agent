import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCollector } from "../src/collect";
import { parsePiSession } from "../src/piSession";
import { FakeFs, FakeSdk, PI_ROOT, ROOTS, thread } from "./fakes";

const LEAD = "/tmp/ctxui/fixtures/pi-lead-session.jsonl";
const COMPACTED = "/tmp/ctxui/fixtures/pi-compacted-session.jsonl";
const COMPACTED_EVENTS = "/tmp/ctxui/fixtures/pi-compacted-events.json";
const hasLocal = existsSync(LEAD) && existsSync(COMPACTED) && existsSync(COMPACTED_EVENTS);

function setup(sessionText: string, rows: { seq: number; type: string; createdAt: number; data: unknown }[], providerThreadId = "thr_perf") {
  const fs = new FakeFs();
  const path = `${PI_ROOT}/${providerThreadId}.jsonl`;
  const sdk = new FakeSdk();
  const threadId = "thr_perf";
  fs.write(`${PI_ROOT}/${providerThreadId}.jsonl`, sessionText);
  sdk.threads.set(threadId, thread(threadId, "pi"));
  sdk.events.set(
    threadId,
    rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })),
  );
  sdk.usage.set(threadId, { usedTokens: 120_000, modelContextWindow: 1_000_000 });
  let clock = 0;
  const collector = createCollector({ sdk, fs, roots: ROOTS, now: () => clock });
  return { collector, threadId, advance: (ms: number) => (clock += ms), append: (line: string) => fs.append(path, line) };
}

const identity = (seq: number) => ({ seq, type: "thread/identity", createdAt: 0, data: { providerThreadId: "thr_perf" } });

describe.skipIf(!hasLocal)("performance on full-size local sessions", () => {
  it("warm meter on the 1.6 MB lead session stays under 30 ms", async () => {
    const { collector, threadId, advance, append } = setup(readFileSync(LEAD, "utf8"), [identity(1)]);
    const cold = await collector.report(threadId);
    expect(cold.source.kind).toBe("pi-session");
    advance(5_000);
    const started = performance.now();
    await collector.meter(threadId);
    const warmStale = performance.now() - started;
    const again = performance.now();
    await collector.meter(threadId);
    const warmFresh = performance.now() - again;
    append(`${JSON.stringify({ type: "message", id: "perf1", message: { role: "toolResult", toolCallId: "x", toolName: "bash", content: [{ type: "text", text: "y".repeat(20_000) }] } })}\n`);
    advance(5_000);
    const grown = performance.now();
    const meter = await collector.meter(threadId);
    const warmAppended = performance.now() - grown;
    console.log(`lead warm meter: ${warmStale.toFixed(1)} ms after expiry, ${warmAppended.toFixed(1)} ms after an append, ${warmFresh.toFixed(2)} ms fresh; ${cold.categories.length} categories, largest ${cold.largest[0]?.tokens}`);
    expect(warmStale).toBeLessThan(30);
    expect(warmAppended).toBeLessThan(30);
    expect(meter.segments.find((segment) => segment.id === "toolResults")).toBeDefined();
  });

  it("cold report on the 2.5 MB compacted session stays under 400 ms", async () => {
    const rows = JSON.parse(readFileSync(COMPACTED_EVENTS, "utf8")) as { seq: number; type: string; createdAt: number; data: unknown }[];
    const text = readFileSync(COMPACTED, "utf8");
    const { collector, threadId } = setup(text, rows, "thr_gtg4kt23i2");
    const started = performance.now();
    const report = await collector.report(threadId);
    const cold = performance.now() - started;
    console.log(`compacted cold report: ${cold.toFixed(1)} ms, ${report.turns.length} turns, ${report.categories.length} categories`);
    expect(cold).toBeLessThan(400);
    expect(report.source.kind).toBe("pi-session");
    const compacted = report.courseChanges.filter((change) => change.kind === "compacted");
    expect(compacted.map((change) => change.tokensBefore)).toEqual([161_703, 172_004]);
    expect(compacted.map((change) => change.beforeTurnIndex)).toEqual([7, 16]);
    expect(report.turns[3]?.lastSeq).toBe(4530);
    expect(report.turns.filter((turn) => turn.state === "summarized")).toHaveLength(15);
    expect(parsePiSession(text).items.filter((item) => item.category === "summary")).toHaveLength(1);
  });
});
