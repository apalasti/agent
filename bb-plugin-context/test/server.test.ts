import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { createPlugin } from "../server";
import { CONTEXT_CHANGED, meterSchema, reportSchema } from "../src/contract";
import type { EventRow } from "../src/events";
import { FakeFs, PI_ROOT, ROOTS, fixture, fixtureUsage } from "./fakes";

const PI = "thr_9znzytnw6r";
const PI_SESSION = `${PI_ROOT}/pi_ae5da616-e0a4-4359-98a7-0c995bb2a235.jsonl`;

let fs: FakeFs;
let rows: EventRow[];

async function load() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "context",
    sdk: {
      threads: {
        events: {
          list: async ({ afterSeq, limit, types }: { afterSeq?: string; limit?: string; types?: string[] }) =>
            rows
              .filter((row) => row.seq > Number(afterSeq ?? 0) && (types === undefined || types.includes(row.type)))
              .slice(0, Number(limit ?? 100))
              .map((row) => ({ id: `evt_${row.seq}`, scope: { kind: "thread" }, threadId: PI, ...row })),
        },
        get: async () => ({
          thread: { id: PI, providerId: "pi", status: "idle", sourceThreadId: null },
          environment: { id: "env_1", hostId: "host_1", path: "/tmp/wt-demo" },
        }),
        context: async () => ({ usage: fixtureUsage("pi-context.json") }),
      },
      system: { config: async () => ({ primaryHostId: "host_1" }) },
    } as never,
  });
  await createPlugin({ fs, roots: ROOTS })(bb);
  return harness;
}

beforeEach(() => {
  fs = new FakeFs();
  fs.write(PI_SESSION, fixture("pi-probe-session.jsonl"));
  const raw = JSON.parse(fixture("pi-probe-events.json")) as (Omit<EventRow, "createdAt"> & { createdAt: number })[];
  rows = raw.map((row) => ({ ...row, createdAt: row.createdAt as unknown as string }));
});

describe("rpc", () => {
  it("serves meter and report through the contract, paging events past 100", async () => {
    const extra: EventRow[] = Array.from({ length: 150 }, (_, index) => ({
      seq: 1000 + index,
      type: "thread/contextWindowUsage/updated",
      createdAt: (1_791_392_400_000 + index) as unknown as string,
      data: { contextWindowUsage: { usedTokens: 17_071, modelContextWindow: 1_000_000 } },
    }));
    rows = [...rows, ...extra];
    const harness = await load();
    const meter = meterSchema.parse(await harness.behavior.callRpc("meter", { threadId: PI }));
    expect(meter.window).toMatchObject({ usedTokens: 17_071, basis: "measured" });
    const report = reportSchema.parse(await harness.behavior.callRpc("report", { threadId: PI }));
    expect(report.turns).toHaveLength(2);
    expect(report.window.measuredAt).toBe(new Date(1_791_392_400_149).toISOString());
    expect(report.turns[0]?.at).toBe("2026-10-07T16:57:37.781Z");
  });
});

describe("events", () => {
  it("invalidates and publishes context-changed for the thread", async () => {
    const harness = await load();
    await harness.behavior.callRpc("meter", { threadId: PI });
    rows = rows.filter((row) => row.seq <= 54);
    const { errors } = await harness.behavior.emitThreadEvent("experimental_thread.events", {
      thread: { id: PI } as never,
      sequence: 54,
    });
    expect(errors).toEqual([]);
    expect(harness.inspection.realtimeSignals).toEqual([{ channel: CONTEXT_CHANGED, payload: { threadId: PI } }]);
  });
});

describe("cli", () => {
  it("prints a bounded summary", async () => {
    const harness = await load();
    const result = await harness.behavior.runCli(["show", "--thread", PI]);
    expect(result.exitCode).toBe(0);
    const text = String(result.stdout);
    expect(text.split("\n")[0]).toBe(`${PI} · pi · claude-opus-5-5 · idle`);
    expect(text).toContain("Context 17k / 1m · 1.7% (measured)");
    expect(text).toMatch(/Tool definitions\s+\d/);
    expect(text).toContain("Largest items:");
    expect(text).toContain("#2 seq 55");
    expect(text).toContain("-- Edited here");
    expect(text).toContain("-- Compaction skipped");
  });

  it("uses the calling thread for --self and emits JSON", async () => {
    const harness = await load();
    const result = await harness.behavior.runCli(["show", "--self", "--json", "--turns", "1"], { threadId: PI });
    expect(reportSchema.parse(JSON.parse(String(result.stdout))).threadId).toBe(PI);
    const missing = await harness.behavior.runCli(["show", "--self"]);
    expect(missing.exitCode).not.toBe(0);
  });
});
