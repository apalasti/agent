import { beforeEach, describe, expect, it } from "vitest";
import { STALE_TRANSCRIPT_MS, createCollector, foregroundOutcome } from "../src/collect";
import type { EventRow } from "../src/events";
import {
  FOREGROUND_TASKS,
  FakeFs,
  FakeSdk,
  PROBE_SESSION,
  PROBE_TASKS,
  SESSIONS_ROOT,
  TASKS_ROOT,
  fixture,
  fixtureEvents,
  lines,
  seedForeground,
  seedProbe,
} from "./fakes";

const PROBE = "thr_rgeid7wgtp";
const FOREGROUND = "thr_gtg4kt23i2";
const NOW = Date.parse("2026-10-06T20:13:00Z");

let fs: FakeFs;
let sdk: FakeSdk;
let clock: number;
let changes: string[];

function collector() {
  return createCollector({
    sdk,
    fs,
    tasksRoot: TASKS_ROOT,
    sessionsRoot: SESSIONS_ROOT,
    now: () => clock,
    onChange: (threadId) => changes.push(threadId),
  });
}

beforeEach(() => {
  fs = new FakeFs();
  sdk = new FakeSdk();
  clock = NOW;
  changes = [];
});

describe("threadSubagents", () => {
  it("joins events, session records and transcripts for finished background agents", async () => {
    seedProbe(fs);
    sdk.events.set(PROBE, fixtureEvents("probe-events.json"));
    const subagents = await collector().threadSubagents(PROBE);
    expect(subagents).toHaveLength(2);
    expect(subagents[0]).toEqual({
      agentId: "3a2ff4b2-3d37-45c",
      callId: "daf579d39d-i1",
      description: "count files",
      type: "Explore",
      model: "claude-sonnet-5-5",
      background: true,
      status: "completed",
      startedAt: expect.any(String),
      updatedAt: "2026-10-06T20:12:27.728Z",
      finishedAt: "2026-10-06T20:12:27.729Z",
      turns: 3,
      toolCalls: 2,
      lastActivity: expect.stringMatching(/^The repo has 3 files/),
      result: expect.stringMatching(/^The repo has 3 files/),
      outputFile: `${PROBE_TASKS}/3a2ff4b2-3d37-45c.output`,
      parentAgentId: null,
      filesTouched: [],
    });
    expect(subagents[1]).toMatchObject({ agentId: "27e7abbc-45cf-47d", status: "completed", turns: 3, toolCalls: 3 });
  });

  it("resolves a finished foreground agent's id through the session's tool result", async () => {
    seedForeground(fs);
    sdk.events.set(FOREGROUND, fixtureEvents("foreground-events.json"));
    const [subagent] = await collector().threadSubagents(FOREGROUND);
    expect(subagent).toMatchObject({
      agentId: "b0a2601e-c4a4-483",
      callId: "da8aac31f0-i45",
      background: false,
      status: "completed",
      turns: 6,
      toolCalls: 7,
      outputFile: `${FOREGROUND_TASKS}/b0a2601e-c4a4-483.output`,
    });
    expect(subagent?.result).toMatch(/^All eight extensions/);
  });

  it("finds a running foreground agent's transcript by its prompt", async () => {
    const started = fixtureEvents("foreground-events.json").filter((row) => row.seq <= 452);
    const prompt = (started.at(-1)?.data as { item: { arguments: { prompt: string } } }).item.arguments.prompt;
    const [, ...rest] = lines(fixture("foreground-b0a2601e.output"));
    const head = JSON.stringify({ agentId: "b0a2601e-c4a4-483", message: { role: "user", content: prompt }, timestamp: "t" });
    fs.write(`${SESSIONS_ROOT}/pi_b8f629db-1e91-404b-a066-47c0c8740a13.jsonl`, `${lines(fixture("foreground-session.jsonl"))[0]}\n`);
    fs.write(`${FOREGROUND_TASKS}/other.output`, `${JSON.stringify({ message: { role: "user", content: "other" } })}\n`);
    fs.write(`${FOREGROUND_TASKS}/b0a2601e-c4a4-483.output`, `${[head, ...rest.slice(0, 4)].join("\n")}\n`);
    sdk.events.set(FOREGROUND, started);
    const [subagent] = await collector().threadSubagents(FOREGROUND);
    expect(subagent).toMatchObject({ agentId: "b0a2601e-c4a4-483", status: "running", background: false, turns: 1, toolCalls: 2 });
  });

  it("tracks a running background agent as its transcript grows, then completes it from the record", async () => {
    const events = fixtureEvents("probe-events.json");
    const sessionLines = lines(fixture("probe-session.jsonl"));
    const transcript = lines(fixture("probe-3a2ff4b2.output"));
    sdk.events.set(PROBE, events.filter((row) => row.seq <= 18));
    fs.write(PROBE_SESSION, `${sessionLines.filter((line) => !line.includes("subagents:record")).slice(0, 6).join("\n")}\n`);
    const output = `${PROBE_TASKS}/3a2ff4b2-3d37-45c.output`;
    fs.write(output, `${transcript.slice(0, 2).join("\n")}\n`, NOW);
    fs.write(`${PROBE_TASKS}/27e7abbc-45cf-47d.output`, fixture("probe-27e7abbc.output"), NOW);
    const collect = collector();

    const first = (await collect.threadSubagents(PROBE))[0];
    expect(first).toMatchObject({ status: "running", turns: 0, toolCalls: 0 });

    fs.append(output, `${transcript.slice(2, 4).join("\n")}\n`, NOW + 1);
    const second = (await collect.threadSubagents(PROBE))[0];
    expect(second).toMatchObject({ status: "running", turns: 1, toolCalls: 1, lastActivity: "bash: git ls-files | wc -l" });
    expect(fs.reads.filter((read) => read.path === output).at(-1)?.start).toBeGreaterThan(0);
    expect(changes).toEqual([PROBE]);

    sdk.events.set(PROBE, events);
    fs.write(PROBE_SESSION, fixture("probe-session.jsonl"));
    fs.write(output, fixture("probe-3a2ff4b2.output"), NOW + 2);
    const third = (await collect.threadSubagents(PROBE))[0];
    expect(third).toMatchObject({ status: "completed", turns: 3 });
    expect(sdk.eventCalls.map((call) => call.afterSeq)).toEqual([0, 18, 18]);
  });

  it("reports a launched agent with no record, no live turn and a stale transcript as unknown", async () => {
    const events = fixtureEvents("probe-events.json").filter((row) => row.seq <= 18 || row.type === "turn/completed");
    sdk.events.set(PROBE, events);
    const transcript = lines(fixture("probe-3a2ff4b2.output"));
    fs.write(`${PROBE_TASKS}/3a2ff4b2-3d37-45c.output`, `${transcript.slice(0, 4).join("\n")}\n`, NOW - STALE_TRANSCRIPT_MS - 1);
    const [subagent] = await collector().threadSubagents(PROBE);
    expect(subagent).toMatchObject({ status: "unknown", turns: 1 });
  });

  it("never reads an output file outside the pi-subagents temp root", async () => {
    const outside = "/etc/secret/x.output";
    fs.write(outside, fixture("probe-3a2ff4b2.output"));
    const row = (seq: number, type: string, result?: string): EventRow => ({
      seq,
      type,
      createdAt: NOW,
      data: {
        providerThreadId: "pi_x",
        item: {
          type: "toolCall",
          id: "c1",
          tool: "Agent",
          arguments: { description: "d", subagent_type: "Explore", prompt: "p" },
          ...(result ? { result, status: "completed" } : {}),
        },
      },
    });
    sdk.events.set(PROBE, [
      row(1, "item/started"),
      row(2, "item/completed", `Agent started in background.\nAgent ID: x\nOutput file: ${outside}\n`),
    ]);
    const [subagent] = await collector().threadSubagents(PROBE);
    expect(subagent).toMatchObject({ agentId: "x", turns: 0 });
    expect(fs.reads).toEqual([]);
  });
});

describe("transcript", () => {
  it("returns entries by call id or agent-id prefix and nested children", async () => {
    seedProbe(fs);
    sdk.events.set(PROBE, fixtureEvents("probe-events.json"));
    const parent = `${PROBE_TASKS}/27e7abbc-45cf-47d.output`;
    const nested = [
      {
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "n1", name: "Agent", arguments: { description: "kid", subagent_type: "Explore", prompt: "kid task" } }],
          stopReason: "toolUse",
        },
        timestamp: "2026-10-06T20:12:40Z",
      },
      { message: { role: "toolResult", toolCallId: "n1", content: [{ type: "text", text: "Nested agent started in background. Agent ID: kid-1" }] } },
      {
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "n2", name: "get_subagent_result", arguments: { agent_id: "kid-1", wait: true } }],
          stopReason: "toolUse",
        },
      },
      { message: { role: "toolResult", toolCallId: "n2", content: [{ type: "text", text: "kid says hi" }] } },
    ];
    fs.append(parent, `${nested.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    fs.write(
      `${PROBE_TASKS}/kid-1.output`,
      `${JSON.stringify({ agentId: "kid-1", message: { role: "user", content: "kid task" }, timestamp: "2026-10-06T20:12:41Z" })}\n`,
    );

    const collect = collector();
    const byCall = await collect.transcript(PROBE, "daf579d39d-i2", 400);
    expect(byCall?.subagent.agentId).toBe("27e7abbc-45cf-47d");
    expect(byCall?.children).toEqual([
      expect.objectContaining({
        agentId: "kid-1",
        callId: "n1",
        parentAgentId: "27e7abbc-45cf-47d",
        status: "completed",
        result: "kid says hi",
        background: true,
        outputFile: `${PROBE_TASKS}/kid-1.output`,
      }),
    ]);

    const byPrefix = await collect.transcript(PROBE, "3a2ff4b2", 2);
    expect(byPrefix).toMatchObject({ truncated: true, children: [] });
    expect(byPrefix?.entries.map((entry) => entry.kind)).toEqual(["prompt", "text"]);

    const child = await collect.transcript(PROBE, "kid-1", 400);
    expect(child?.subagent).toMatchObject({ callId: "n1", parentAgentId: "27e7abbc-45cf-47d" });
    expect(child?.entries).toEqual([{ kind: "prompt", at: "2026-10-06T20:12:41Z", text: "kid task" }]);

    expect(await collect.transcript(PROBE, "nope", 10)).toBeNull();
  });
});

describe("files touched and display paths", () => {
  const output = `${PROBE_TASKS}/3a2ff4b2-3d37-45c.output`;
  const line = (message: object) =>
    `${JSON.stringify({ isSidechain: true, agentId: "3a2ff4b2-3d37-45c", type: "x", timestamp: "2026-10-06T20:12:30Z", message })}\n`;

  it("resolves relative paths against the session cwd and shortens summaries under the environment", async () => {
    seedProbe(fs);
    sdk.events.set(PROBE, fixtureEvents("probe-events.json"));
    sdk.environments.set(PROBE, { id: "env_1", hostId: "host_1", path: "/tmp/wt-demo" });
    fs.append(
      output,
      line({
        role: "assistant",
        content: [
          { type: "toolCall", id: "w1", name: "write", arguments: { path: "notes.txt", content: "x" } },
          { type: "toolCall", id: "e1", name: "edit", arguments: { path: "/private/tmp/wt-demo/notes.txt", edits: [] } },
          { type: "toolCall", id: "b1", name: "bash", arguments: { command: "cd /tmp/wt-demo && ls /private/tmp/wt-demo/src" } },
        ],
      }) +
        line({ role: "toolResult", toolCallId: "w1", toolName: "write", content: [{ type: "text", text: "ok" }], isError: false }) +
        line({ role: "toolResult", toolCallId: "e1", toolName: "edit", content: [{ type: "text", text: "ok" }], isError: false }) +
        line({ role: "toolResult", toolCallId: "b1", toolName: "bash", content: [{ type: "text", text: "a" }], isError: false }),
    );
    const collect = collector();
    const [first] = await collect.threadSubagents(PROBE);
    expect(first?.filesTouched).toEqual([{ path: "/private/tmp/wt-demo/notes.txt", writes: 1, edits: 1 }]);
    expect(first?.lastActivity).toBe("bash: ls src");
    expect(collect.environment(PROBE)).toEqual({ id: "env_1", hostId: "host_1", path: "/tmp/wt-demo" });
    const found = await collect.transcript(PROBE, "3a2ff4b2", 400);
    expect(found?.entries.at(-1)).toMatchObject({ kind: "tool", summary: "bash: ls src", args: expect.stringContaining("cd /tmp/wt-demo") });
  });
});

describe("summaries", () => {
  it("covers recent pi threads with subagents and skips refetching idle unchanged ones", async () => {
    seedProbe(fs);
    sdk.events.set(PROBE, fixtureEvents("probe-events.json"));
    sdk.events.set("thr_plain", []);
    sdk.threads = [
      { id: PROBE, providerId: "pi", status: "idle", updatedAt: NOW - 60_000 },
      { id: "thr_plain", providerId: "pi", status: "idle", updatedAt: NOW - 1000 },
      { id: "thr_old", providerId: "pi", status: "idle", updatedAt: NOW - 2 * 24 * 3600_000 },
      { id: "thr_claude", providerId: "claude-code", status: "active", updatedAt: NOW },
    ];
    const collect = collector();
    expect(await collect.summaries()).toEqual([{ threadId: PROBE, running: 0, total: 2 }]);
    expect(sdk.eventCalls.map((call) => call.threadId).sort()).toEqual(["thr_plain", PROBE]);

    clock += 5000;
    await collect.summaries();
    expect(sdk.eventCalls).toHaveLength(2);

    sdk.threads[0] = { id: PROBE, providerId: "pi", status: "active", updatedAt: NOW };
    clock += 5000;
    await collect.summaries();
    expect(sdk.eventCalls).toHaveLength(3);
  });

  it("takes explicit thread ids", async () => {
    seedProbe(fs);
    sdk.events.set(PROBE, fixtureEvents("probe-events.json"));
    expect(await collector().summaries([PROBE, "thr_none"])).toEqual([{ threadId: PROBE, running: 0, total: 2 }]);
  });
});

describe("foregroundOutcome", () => {
  it("maps headlines to statuses and strips them from the report", () => {
    expect(foregroundOutcome("Agent completed in 3s (1 tool uses).\n\nhello")).toEqual({ status: "completed", result: "hello" });
    expect(foregroundOutcome("Agent completed in 3s (1 tool uses) (STOPPED BY THE USER — …).\n\npartial").status).toBe("stopped");
    expect(foregroundOutcome("Agent failed: boom").status).toBe("failed");
  });
});
