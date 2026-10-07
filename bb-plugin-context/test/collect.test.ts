import { beforeEach, describe, expect, it } from "vitest";
import { createCollector, FRESH_MS, type CollectMemo } from "../src/collect";
import type { EventRow } from "../src/events";
import { CLAUDE_ROOT, FakeFs, FakeSdk, PI_ROOT, ROOTS, fixture, fixtureEvents, fixtureUsage, thread } from "./fakes";

const PI = "thr_9znzytnw6r";
const PI_SESSION = `${PI_ROOT}/pi_ae5da616-e0a4-4359-98a7-0c995bb2a235.jsonl`;
const CC = "thr_4p46bmnani";
const CC_SESSION = `${CLAUDE_ROOT}/-private-tmp-wt-demo/0157976d-4556-49bc-8888-0cfb87754f36.jsonl`;

let fs: FakeFs;
let sdk: FakeSdk;
let clock: number;

const collector = (memo?: CollectMemo) => createCollector({ sdk, fs, roots: ROOTS, now: () => clock, ...(memo ? { memo } : {}) });

beforeEach(() => {
  fs = new FakeFs();
  sdk = new FakeSdk();
  clock = 1_000_000;
  sdk.threads.set(PI, thread(PI, "pi"));
  sdk.events.set(PI, fixtureEvents("pi-probe-events.json"));
  sdk.usage.set(PI, fixtureUsage("pi-context.json"));
  sdk.threads.set(CC, thread(CC, "claude-code"));
  sdk.events.set(CC, fixtureEvents("cc-probe-events.json"));
  sdk.usage.set(CC, fixtureUsage("cc-context-no-snapshot.json"));
});

describe("collector", () => {
  it("parses only appended bytes and matches a full parse", async () => {
    const text = fixture("pi-probe-session.jsonl");
    const lines = text.split("\n");
    const head = `${lines.slice(0, 6).join("\n")}\n${lines[6]?.slice(0, 20)}`;
    fs.write(PI_SESSION, head);
    const incremental = collector();
    const partial = await incremental.report(PI);
    expect(partial.source).toMatchObject({ kind: "pi-session", path: PI_SESSION });

    fs.write(PI_SESSION, text);
    incremental.invalidate(PI);
    fs.reads = [];
    const appended = await incremental.report(PI);
    const parsedFrom = fs.reads.filter((read) => read.end === Buffer.byteLength(text)).map((read) => read.start);
    expect(parsedFrom).toEqual([Buffer.byteLength(head) - (lines[6]?.slice(0, 20).length ?? 0)]);

    const full = await collector().report(PI);
    expect(appended.categories).toEqual(full.categories);
    expect(appended.turns).toEqual(full.turns);
  });

  it("reparses from the start when the file shrinks", async () => {
    const text = fixture("pi-probe-session.jsonl");
    fs.write(PI_SESSION, text);
    const cached = collector();
    await cached.report(PI);

    const shorter = `${text.split("\n").slice(0, 5).join("\n")}\n`;
    fs.write(PI_SESSION, shorter);
    cached.invalidate(PI);
    fs.reads = [];
    const after = await cached.report(PI);
    expect(fs.reads.some((read) => read.start === 0)).toBe(true);

    const fresh = await collector().report(PI);
    expect(after.categories).toEqual(fresh.categories);
    expect(after.categories.find((category) => category.id === "toolResults")).toBeUndefined();
  });

  it("reparses when bytes before the old end were rewritten", async () => {
    const text = fixture("pi-probe-session.jsonl");
    fs.write(PI_SESSION, text);
    const cached = collector();
    await cached.report(PI);
    fs.write(PI_SESSION, text.replace('"seq 1 300"', '"seq 1 999"') + "\n");
    cached.invalidate(PI);
    const after = await cached.report(PI);
    const results = after.categories.find((category) => category.id === "toolResults");
    expect(results?.entries[0]?.detail).toBe("seq 1 999");
  });

  it("serves a fresh cache without calling bb, and refetches after invalidation or 2 s", async () => {
    fs.write(PI_SESSION, fixture("pi-probe-session.jsonl"));
    const cached = collector();
    await cached.meter(PI);
    await cached.meter(PI);
    expect(sdk.calls).toEqual({ events: 1, context: 1 });
    cached.invalidate(PI);
    await cached.meter(PI);
    expect(sdk.calls.context).toBe(2);
    clock += FRESH_MS;
    await cached.report(PI);
    expect(sdk.calls.context).toBe(3);
  });

  it("fetches only new events", async () => {
    const rows = fixtureEvents("pi-probe-events.json");
    sdk.events.set(PI, rows.filter((row) => row.seq <= 54));
    const cached = collector();
    expect((await cached.report(PI)).turns).toHaveLength(1);
    sdk.events.set(PI, rows);
    const listed: number[] = [];
    const original = sdk.listEvents.bind(sdk);
    sdk.listEvents = async (threadId: string, afterSeq: number) => {
      listed.push(afterSeq);
      return original(threadId, afterSeq);
    };
    cached.invalidate(PI);
    expect((await cached.report(PI)).turns).toHaveLength(2);
    expect(listed).toEqual([54]);
  });

  it("estimates from the previous session's fixed parts until the edited session has a file and a measurement", async () => {
    fs.write(PI_SESSION, fixture("pi-probe-session.jsonl"));
    const rows = fixtureEvents("pi-probe-events.json").filter((row) => row.seq <= 67);
    sdk.events.set(PI, rows);
    const cached = collector();
    const before = await cached.report(PI);
    const at = "2026-10-07T17:00:00.000Z";
    sdk.events.set(PI, [
      ...rows,
      { seq: 68, type: "system/operation", createdAt: at, data: { operation: "edit_message", status: "completed", metadata: { cutoffSequence: 55, oldMaxSequence: 67 } } },
      { seq: 69, type: "client/turn/requested", createdAt: at, data: { request: { method: "turn/start" }, input: [{ type: "text", text: "Print seq 1 5 instead." }] } },
      { seq: 70, type: "thread/identity", createdAt: at, data: { providerThreadId: "pi_new" } },
    ]);
    sdk.threads.set(PI, thread(PI, "pi", { status: "active" }));
    cached.invalidate(PI);
    const after = await cached.report(PI);
    expect(after.window).toMatchObject({ basis: "estimated", recomputing: true });
    expect(after.turns.map((turn) => turn.requestSeq)).toEqual([42, 69]);
    expect(after.turns[1]?.tokensBefore).toBe(16_304);
    expect(after.window.usedTokens).toBeGreaterThanOrEqual(16_304);
    expect(after.courseChanges[1]).toMatchObject({ kind: "edited", discardedTurns: 1, tokensBefore: 17_071, beforeTurnIndex: 2 });
    expect(after.categories.find((category) => category.id === "toolResults")).toBeUndefined();
    expect(before.categories.find((category) => category.id === "toolResults")).toBeDefined();
  });

  it("leaves out the discarded branch while the old session file is still current after an edit", async () => {
    fs.write(PI_SESSION, fixture("pi-probe-session.jsonl"));
    const rows = fixtureEvents("pi-probe-events.json").filter((row) => row.seq <= 67);
    const at = "2026-10-07T17:00:00.000Z";
    sdk.events.set(PI, [
      ...rows,
      { seq: 68, type: "system/operation", createdAt: at, data: { operation: "edit_message", status: "completed", metadata: { cutoffSequence: 55, oldMaxSequence: 67 } } },
      { seq: 69, type: "client/turn/requested", createdAt: at, data: { request: { method: "turn/start" }, input: [{ type: "text", text: "Print seq 1 5 instead." }] } },
    ]);
    const report = await collector().report(PI);
    expect(report.window).toMatchObject({ basis: "estimated", recomputing: true });
    expect(report.categories.find((category) => category.id === "toolResults")).toBeUndefined();
    expect(report.window.usedTokens).toBeLessThan(16_304 + 100);
    expect(report.window.usedTokens).toBeGreaterThanOrEqual(16_304);
  });

  it("finds Claude Code transcripts by file name across project dirs", async () => {
    fs.write(`${CLAUDE_ROOT}/-other/unrelated.jsonl`, "{}\n");
    fs.write(CC_SESSION, fixture("cc-probe-transcript.jsonl"));
    const report = await collector().report(CC);
    expect(report.source).toMatchObject({ kind: "claude-transcript", path: CC_SESSION });
    expect(report.turns[0]?.largest.length).toBeGreaterThan(0);
  });

  it("falls back to bb's total for remote threads", async () => {
    fs.write(PI_SESSION, fixture("pi-probe-session.jsonl"));
    sdk.threads.set(PI, thread(PI, "pi", { hostId: "host_remote" }));
    const report = await collector().report(PI);
    expect(report.source.kind).toBe("bb-only");
    expect(report.window).toMatchObject({ usedTokens: 17_071, basis: "measured" });
  });

  it("remembers what an edit discarded across collectors, since bb deletes the dead events", async () => {
    const store = new Map<string, unknown>();
    const memo: CollectMemo = { get: async (key) => store.get(key), set: async (key, value) => void store.set(key, value) };
    const rows = fixtureEvents("pi-probe-events.json");
    const dead: EventRow[] = [
      { seq: 1, type: "client/turn/requested", createdAt: "t", data: { request: { method: "thread/start" }, input: [{ type: "text", text: "a" }] } },
      { seq: 9, type: "thread/contextWindowUsage/updated", createdAt: "t", data: { contextWindowUsage: { usedTokens: 30_000 } } },
      { seq: 20, type: "client/turn/requested", createdAt: "t", data: { request: { method: "turn/start" }, input: [{ type: "text", text: "b" }] } },
    ];
    sdk.events.set(PI, [...dead, ...rows.filter((row) => row.seq < 41)]);
    const before = collector(memo);
    await before.report(PI);
    sdk.events.set(PI, rows);
    before.invalidate(PI);
    const warm = await before.report(PI);
    expect(warm.courseChanges[0]).toMatchObject({ kind: "edited", discardedTurns: 2, tokensBefore: 30_000 });

    const cold = await collector(memo).report(PI);
    expect(cold.courseChanges[0]).toMatchObject({ kind: "edited", discardedTurns: 2, tokensBefore: 30_000 });
  });

  it("keeps the thread's last known window while nothing reports one", async () => {
    const store = new Map<string, unknown>();
    const memo: CollectMemo = { get: async (key) => store.get(key), set: async (key, value) => void store.set(key, value) };
    fs.write(PI_SESSION, fixture("pi-probe-session.jsonl"));
    await collector(memo).report(PI);
    expect(store.get(`window:${PI}`)).toBe(1_000_000);

    const at = "2026-10-07T17:00:00.000Z";
    sdk.usage.set(PI, null);
    sdk.events.set(PI, [
      { seq: 68, type: "system/operation", createdAt: at, data: { operation: "edit_message", status: "completed", metadata: { cutoffSequence: 1, oldMaxSequence: 67 } } },
      { seq: 69, type: "client/turn/requested", createdAt: at, data: { request: { method: "turn/start" }, input: [{ type: "text", text: "Start over." }] } },
      { seq: 70, type: "thread/identity", createdAt: at, data: { providerThreadId: "pi_new" } },
      { seq: 71, type: "thread/contextWindowUsage/updated", createdAt: at, data: { providerThreadId: "pi_new", contextWindowUsage: { usedTokens: null } } },
    ]);
    const report = await collector(memo).report(PI);
    expect(report.window).toMatchObject({ recomputing: true, contextWindow: 1_000_000 });
  });

  it("gives a fresh fork its source thread's window", async () => {
    const FORK = "thr_hvxb2yncdz";
    sdk.threads.set(FORK, thread(FORK, "pi", { sourceThreadId: PI }));
    sdk.events.set(FORK, fixtureEvents("pi-fork-events.json"));
    sdk.usage.set(FORK, null);
    fs.write(`${PI_ROOT}/${FORK}.jsonl`, fixture("pi-fork-session.jsonl"));
    const report = await collector().report(FORK);
    expect(report.window).toMatchObject({ basis: "estimated", contextWindow: 1_000_000 });

    sdk.threads.set("thr_orphan", thread("thr_orphan", "pi"));
    expect((await collector().report("thr_orphan")).window.contextWindow).toBeNull();
  });
});
