import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { createPlugin } from "../server";
import { SUBAGENTS_CHANGED } from "../src/contract";
import type { EventRow } from "../src/events";
import { FakeFs, PROBE_TASKS, SESSIONS_ROOT, TASKS_ROOT, fixture, fixtureEvents, lines, seedProbe } from "./fakes";

const PROBE = "thr_rgeid7wgtp";
const NOW = Date.parse("2026-10-06T20:13:00Z");

let fs: FakeFs;
let events: EventRow[];

async function load() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "subagents",
    sdk: {
      threads: {
        events: {
          list: async ({ afterSeq, limit, types }: { afterSeq?: string; limit?: string; types?: string[] }) =>
            events
              .filter((row) => row.seq > Number(afterSeq ?? 0) && (types === undefined || types.includes(row.type)))
              .slice(0, Number(limit ?? 100))
              .map((row) => ({ id: `evt_${row.seq}`, scope: { kind: "thread" }, threadId: PROBE, ...row })),
        },
        list: async () => [{ id: PROBE, providerId: "pi", status: "idle", updatedAt: NOW - 1000 }],
        get: async () => ({ id: PROBE, environment: { id: "env_1", hostId: "host_1", path: "/tmp/wt-demo" } }),
      },
    } as never,
  });
  await createPlugin({ fs, tasksRoot: TASKS_ROOT, sessionsRoot: SESSIONS_ROOT, now: () => NOW })(bb);
  return harness;
}

beforeEach(() => {
  fs = new FakeFs();
  seedProbe(fs);
  events = fixtureEvents("probe-events.json");
});

describe("rpc", () => {
  it("serves threadSubagents, transcript and summaries through the contract", async () => {
    const harness = await load();
    const listed = (await harness.behavior.callRpc("threadSubagents", { threadId: PROBE })) as { subagents: { status: string }[] };
    expect(listed.subagents.map((subagent) => subagent.status)).toEqual(["completed", "completed"]);
    const transcript = (await harness.behavior.callRpc("transcript", { threadId: PROBE, callId: "daf579d39d-i1" })) as {
      entries: unknown[];
      truncated: boolean;
    };
    expect(transcript.truncated).toBe(false);
    expect(transcript.entries).toHaveLength(4);
    expect(await harness.behavior.callRpc("summaries", {})).toEqual({ threads: [{ threadId: PROBE, running: 0, total: 2 }] });
    await expect(harness.behavior.callRpc("transcript", { threadId: PROBE, callId: "missing" })).rejects.toThrow(/No subagent/);
  });

  it("publishes a change when a poll sees a subagent progress", async () => {
    const full = events;
    events = full.filter((row) => row.seq <= 18);
    const output = `${PROBE_TASKS}/3a2ff4b2-3d37-45c.output`;
    const transcript = lines(fixture("probe-3a2ff4b2.output"));
    fs.write(`${SESSIONS_ROOT}/pi_f7522fe0-34e0-44a8-9ce8-aad83df06b33.jsonl`, `${lines(fixture("probe-session.jsonl"))[0]}\n`);
    fs.write(output, `${transcript.slice(0, 2).join("\n")}\n`, NOW);
    const harness = await load();
    await harness.behavior.callRpc("threadSubagents", { threadId: PROBE });
    expect(harness.inspection.realtimeSignals).toEqual([]);
    fs.write(output, fixture("probe-3a2ff4b2.output"), NOW + 1);
    await harness.behavior.callRpc("summaries", { threadIds: [PROBE] });
    expect(harness.inspection.realtimeSignals).toEqual([expect.objectContaining({ channel: SUBAGENTS_CHANGED, payload: { threadId: PROBE } })]);
  });
});

describe("cli", () => {
  it("lists a thread's subagents", async () => {
    const harness = await load();
    const result = await harness.behavior.runCli(["list", "--thread", PROBE]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("3a2ff4b2-3d37-45c  completed Explore (bg)  count files  [3 turns, 2 tools]");
  });

  it("lists recent threads when there is no calling thread", async () => {
    const harness = await load();
    const result = await harness.behavior.runCli(["list"]);
    expect(result.stdout).toBe(`${PROBE}  0 running / 2`);
  });

  it("shows a subagent by id prefix with its transcript tail and result", async () => {
    const harness = await load();
    const result = await harness.behavior.runCli(["show", "27e7", "--thread", PROBE, "--tail", "2"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("27e7abbc-45cf-47d  completed Explore (bg)  read readme");
    expect(result.stdout).toContain("> Read README*");
    expect(result.stdout).toContain("$ read: README.md");
    expect(result.stdout).toContain("Result: `/private/tmp/wt-demo/README.md` contains only");
  });

  it("counts and lists the files a subagent touched", async () => {
    const message = {
      role: "assistant",
      content: [{ type: "toolCall", id: "w1", name: "write", arguments: { path: "notes.txt", content: "x" } }],
    };
    const resultMessage = { role: "toolResult", toolCallId: "w1", toolName: "write", content: [], isError: false };
    fs.append(
      `${PROBE_TASKS}/3a2ff4b2-3d37-45c.output`,
      [message, resultMessage].map((m) => `${JSON.stringify({ timestamp: "2026-10-06T20:12:30Z", message: m })}\n`).join(""),
    );
    const harness = await load();
    const list = await harness.behavior.runCli(["list", "--thread", PROBE]);
    expect(list.stdout).toContain("count files  [4 turns, 3 tools, 1 file edited]");
    const show = await harness.behavior.runCli(["show", "3a2ff4b2", "--thread", PROBE]);
    expect(show.stdout).toContain("files touched (1):\n  notes.txt  (1 write)");
    const rpc = await harness.behavior.callRpc("threadSubagents", { threadId: PROBE });
    expect(rpc).toMatchObject({ environment: { id: "env_1", hostId: "host_1", path: "/tmp/wt-demo" } });
  });

  it("uses the calling thread for --self and refuses unknown ids", async () => {
    const harness = await load();
    const self = await harness.behavior.runCli(["list", "--self", "--json"], { threadId: PROBE });
    expect(JSON.parse(self.stdout ?? "").subagents).toHaveLength(2);
    const missing = await harness.behavior.runCli(["show", "zzz", "--thread", PROBE]);
    expect(missing.exitCode).not.toBe(0);
  });
});
