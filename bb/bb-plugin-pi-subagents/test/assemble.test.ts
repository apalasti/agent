import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assemble, deriveAgentStatus, ownsAgent, type ChildSource, type WorkflowSource } from "../src/assemble";
import { emptyParentFacts, foldParentLine, type ParentFacts, type RecordFact } from "../src/parent";
import { parsePiSession, type PiTranscript } from "../src/piSession";
import { parseJournal, parseMeta } from "../src/workflow";
import { DEMO_RUN, LIVE_RUN, SUBAGENTS_AGENT, WORKFLOWS_AGENT, fixture, lines } from "./fakes";

const NOW = Date.parse("2026-10-08T20:14:30Z");
const QUIET = NOW - 120_000;
const DEMO_CHILDREN = 7;

const SESSION_NAMES = readdirSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sessions"));

function parentFacts(): ParentFacts {
  return lines(fixture("parent.jsonl")).reduce((facts, line) => foldParentLine(line, facts), emptyParentFacts());
}

function children(mtimeOf: (transcript: PiTranscript) => number = () => QUIET): ChildSource[] {
  return SESSION_NAMES.map((name) => parsePiSession(fixture(`sessions/${name}`)))
    .filter((transcript) => transcript.parentSession?.endsWith("pi_e6c62b6b-9ba7-4f95-85af-6183a2877e86.jsonl"))
    .map((transcript) => ({ path: `/s/${transcript.sessionId}.jsonl`, transcript, mtimeMs: mtimeOf(transcript) }));
}

function workflowSources(parent: ParentFacts): WorkflowSource[] {
  return [...parent.workflows.values()].map((launch) => ({
    launch,
    meta: parseMeta(fixture(`tasks/${launch.runId}.workflow.js`)),
    journal: launch.runId === DEMO_RUN ? parseJournal(fixture(`tasks/${DEMO_RUN}.workflow.jsonl`)) : { done: 0, failed: 0 },
    journalMtimeMs: launch.runId === DEMO_RUN ? QUIET : null,
  }));
}

const transcript = (overrides: Partial<PiTranscript> = {}): PiTranscript => ({
  ...parsePiSession(""),
  ...overrides,
});
const record = (status: string, result: string | null = "Report"): RecordFact => ({ status, result, error: null, startedAt: 1, completedAt: 2 });

describe("deriveAgentStatus", () => {
  it("is done or needs-look when the record says completed or steered", () => {
    expect(deriveAgentStatus(record("completed"), undefined, null, NOW, NOW)).toBe("done");
    expect(deriveAgentStatus(record("steered"), undefined, null, NOW, NOW)).toBe("done");
    expect(deriveAgentStatus(record("completed", " \n"), undefined, transcript(), QUIET, NOW)).toBe("needs-look");
  });

  it("uses the transcript report when the record has none", () => {
    expect(deriveAgentStatus(record("completed", null), undefined, transcript({ report: "From transcript" }), QUIET, NOW)).toBe("done");
    expect(deriveAgentStatus(record("completed", ""), undefined, transcript({ report: "From transcript" }), QUIET, NOW)).toBe("done");
  });

  it.each(["error", "stopped", "aborted"])("is failed on %s", (status) => {
    expect(deriveAgentStatus(record(status), undefined, null, NOW, NOW)).toBe("failed");
    expect(deriveAgentStatus(undefined, { status, totalTokens: null, durationMs: null, error: "x" }, null, NOW, NOW)).toBe("failed");
  });

  it("is running without a final status while written in the last 90s", () => {
    expect(deriveAgentStatus(undefined, undefined, transcript({ endedTurn: true }), NOW - 89_000, NOW)).toBe("running");
  });

  it("falls back to the transcript's end of turn, else unknown", () => {
    expect(deriveAgentStatus(undefined, undefined, transcript({ endedTurn: true, report: "Done" }), QUIET, NOW)).toBe("done");
    expect(deriveAgentStatus(undefined, undefined, transcript({ endedTurn: true }), QUIET, NOW)).toBe("needs-look");
    expect(deriveAgentStatus(undefined, undefined, transcript(), QUIET, NOW)).toBe("unknown");
    expect(deriveAgentStatus(undefined, undefined, null, QUIET, NOW)).toBe("unknown");
  });
});

describe("ownsAgent", () => {
  it("matches a session name on the agent id's first 8 characters", () => {
    expect(ownsAgent("Explore#ff796ad3", SUBAGENTS_AGENT)).toBe(true);
    expect(ownsAgent("Explore#ca7df9fa", SUBAGENTS_AGENT)).toBe(false);
    expect(ownsAgent(null, SUBAGENTS_AGENT)).toBe(false);
  });
});

describe("assemble", () => {
  it("joins Agent-tool spawns with their records and child sessions", () => {
    const parent = parentFacts();
    const { agents } = assemble(parent, children(), new Map(), workflowSources(parent), NOW);
    const spawned = agents.filter((agent) => agent.workflowId === null);
    expect(spawned.map((agent) => agent.agentId)).toEqual([SUBAGENTS_AGENT, WORKFLOWS_AGENT]);
    expect(spawned[0]).toMatchObject({
      description: "Map pi subagent disk footprint",
      agentType: "Explore",
      model: "claude-bridge/claude-sonnet-5-5",
      status: "done",
      startedAt: 1791489536831,
      endedAt: 1791489605599,
      totalTokens: 49949,
      context: 41368,
      contextWindow: 1_000_000,
      errors: 0,
    });
    expect(spawned[0]?.steps.filter((step) => step.kind === "tool")).toHaveLength(12);
    expect(spawned[0]?.report).toMatch(/^Findings below\./);
    expect(spawned[0]?.prompt).toMatch(/^Research question, read-only\./);
  });

  it("falls back to the .output file when no child session matches", () => {
    const parent = parentFacts();
    const output: ChildSource = { path: "/t/x.output", transcript: parsePiSession(fixture(`tasks/${SUBAGENTS_AGENT}.output`)), mtimeMs: QUIET };
    const withoutSessions = children().filter((child) => !ownsAgent(child.transcript.name, SUBAGENTS_AGENT));
    const { agents } = assemble(parent, withoutSessions, new Map([[SUBAGENTS_AGENT, output]]), [], NOW);
    expect(agents.find((agent) => agent.agentId === SUBAGENTS_AGENT)).toMatchObject({ totalTokens: 49949, status: "done" });
  });

  it("shows a just-spawned agent with no transcript as running, then unknown once quiet", () => {
    const parent = parentFacts();
    parent.records.clear();
    const spawnedAt = parent.spawns.get(SUBAGENTS_AGENT)!.at;
    const agentAt = (now: number) => assemble(parent, [], new Map(), [], now).agents.find((agent) => agent.agentId === SUBAGENTS_AGENT);
    expect(agentAt(spawnedAt + 1_000)).toMatchObject({ status: "running", endedAt: null, totalTokens: null, steps: [], prompt: "" });
    expect(agentAt(spawnedAt + 100_000)).toMatchObject({ status: "unknown" });
  });

  it("falls back to the transcript's report when the record's result is blank, else has none", () => {
    const parent = parentFacts();
    const blank = { ...parent.records.get(SUBAGENTS_AGENT)!, result: " \n" };
    parent.records.set(SUBAGENTS_AGENT, blank);
    const agentWith = (sources: ChildSource[]) =>
      assemble(parent, sources, new Map(), [], NOW).agents.find((agent) => agent.agentId === SUBAGENTS_AGENT);
    expect(agentWith(children())).toMatchObject({ status: "done", report: expect.stringMatching(/^Findings below\./) });
    expect(agentWith([])).toMatchObject({ status: "needs-look", report: null });
  });

  it("prefers the notification's token count", () => {
    const parent = parentFacts();
    parent.notifications.set(SUBAGENTS_AGENT, { status: "completed", totalTokens: 50_000, durationMs: 68_768, error: null });
    const { agents } = assemble(parent, children(), new Map(), [], NOW);
    expect(agents.find((agent) => agent.agentId === SUBAGENTS_AGENT)?.totalTokens).toBe(50_000);
  });

  it("attributes the remaining child sessions to the workflow whose window holds their start", () => {
    const parent = parentFacts();
    const { agents, workflows } = assemble(parent, children(), new Map(), workflowSources(parent), NOW);
    const demo = agents.filter((agent) => agent.workflowId === DEMO_RUN);
    expect(demo).toHaveLength(DEMO_CHILDREN);
    expect(demo.map((agent) => agent.status)).toEqual(Array(DEMO_CHILDREN).fill("done"));
    expect(demo[0]).toMatchObject({
      agentId: "01a11d13-7360-771f-b48d-25439b8dfd46",
      agentType: "Explore",
      description: 'Read-only. Look at the path "agents" in the current repo. In 1-2 sentences say what it is for, and list up to 4 key files.',
      totalTokens: 9663,
      model: "claude-bridge/claude-sonnet-5-5",
    });
    expect(demo.at(-1)?.agentType).toBe("general-purpose");
    expect(workflows.find((workflow) => workflow.runId === DEMO_RUN)).toEqual({
      runId: DEMO_RUN,
      name: "demo-repo-tour",
      description: "Demo: map three areas of this repo in parallel, suggest one improvement each, then synthesize",
      status: "done",
      phases: ["Map", "Suggest", "Synthesize"],
      startedAt: Date.parse("2026-10-08T19:52:56.351Z"),
      endedAt: Date.parse("2026-10-08T19:52:56.351Z") + 24477,
      done: 7,
      failed: 0,
      totalTokens: 87842,
      error: null,
    });
  });

  it("shows a workflow without a completion as running while its children write", () => {
    const parent = parentFacts();
    const { agents, workflows } = assemble(parent, children((t) => (t.firstAt! > Date.parse("2026-10-08T20:13:00Z") ? NOW - 5_000 : QUIET)), new Map(), workflowSources(parent), NOW);
    expect(agents.filter((agent) => agent.workflowId === LIVE_RUN).map((agent) => [agent.agentType, agent.status, agent.endedAt])).toEqual([
      ["general-purpose", "running", null],
    ]);
    expect(workflows.find((workflow) => workflow.runId === LIVE_RUN)).toMatchObject({
      name: "migrate-bb-plugins-to-pi",
      status: "running",
      phases: ["Build", "Review"],
      endedAt: null,
      totalTokens: null,
      done: 0,
    });
  });

  it("shows a killed workflow and its mid-turn children as unknown once idle", () => {
    const parent = parentFacts();
    const later = NOW + 10 * 60_000;
    const lastWrite = Date.parse("2026-10-08T20:14:00Z");
    const { agents, workflows } = assemble(parent, children(() => lastWrite), new Map(), workflowSources(parent), later);
    expect(agents.find((agent) => agent.workflowId === LIVE_RUN)?.status).toBe("unknown");
    expect(workflows.find((workflow) => workflow.runId === LIVE_RUN)).toMatchObject({ status: "unknown", endedAt: lastWrite });
  });

  it("turns a still-running child of a finished run into unknown", () => {
    const parent = parentFacts();
    const fresh = children(() => NOW);
    const midTurn = fresh.find((child) => child.transcript.name === "Explore#ca7df9fa")!;
    midTurn.transcript = { ...midTurn.transcript, endedTurn: false };
    const { agents } = assemble(parent, fresh, new Map(), workflowSources(parent), NOW);
    expect(agents.find((agent) => agent.agentId === midTurn.transcript.sessionId)?.status).toBe("unknown");
  });

  it("marks a stopped workflow failed with its error", () => {
    const parent = parentFacts();
    parent.notifications.set(DEMO_RUN, { status: "stopped", totalTokens: 100, durationMs: 1_000, error: "killed" });
    const { workflows } = assemble(parent, [], new Map(), workflowSources(parent), NOW);
    expect(workflows.find((workflow) => workflow.runId === DEMO_RUN)).toMatchObject({ status: "failed", error: "killed", totalTokens: 100 });
  });

  it("shows a call still waiting on its result as a running agent with its child session's transcript", () => {
    const parent = lines(fixture("parent.jsonl"))
      .slice(0, 31)
      .reduce((facts, line) => foldParentLine(line, facts), emptyParentFacts());
    const writing = Date.parse("2026-10-08T19:59:30Z");
    const { agents } = assemble(parent, children(() => writing), new Map(), workflowSources(parent), writing + 5_000);
    const pending = agents.filter((agent) => agent.workflowId === null);
    expect(pending.map((agent) => [agent.agentId, agent.callId, agent.pending, agent.status, agent.endedAt])).toEqual([
      ["toolu_019Yi49sdKUqFZ8dkuN8Ysdo", "toolu_019Yi49sdKUqFZ8dkuN8Ysdo", true, "running", null],
      ["toolu_013vKvBs9ZhwAgQRNNG9qFEH", "toolu_013vKvBs9ZhwAgQRNNG9qFEH", true, "running", null],
    ]);
    expect(pending[0]).toMatchObject({
      description: "Map pi subagent disk footprint",
      agentType: "Explore",
      model: "claude-bridge/claude-sonnet-5-5",
      prompt: expect.stringMatching(/^Research question, read-only\./),
    });
    expect(pending[0]?.steps.length).toBeGreaterThan(0);
    expect(pending[1]?.prompt).not.toBe(pending[0]?.prompt);
  });

  it("keeps a pending agent's child session out of a workflow running at the same time", () => {
    const parent = lines(fixture("parent.jsonl"))
      .slice(0, 31)
      .reduce((facts, line) => foldParentLine(line, facts), emptyParentFacts());
    parent.notifications.delete(DEMO_RUN);
    const { agents } = assemble(parent, children(), new Map(), workflowSources(parent), NOW);
    const pendingPrompts = agents.filter((agent) => agent.pending).map((agent) => agent.prompt);
    expect(pendingPrompts).toEqual([expect.stringMatching(/^Research/), expect.stringMatching(/^Research/)]);
    expect(agents.filter((agent) => agent.workflowId === DEMO_RUN).map((agent) => agent.prompt)).not.toContain(pendingPrompts[0]);
    expect(agents.filter((agent) => agent.workflowId === DEMO_RUN).map((agent) => agent.prompt)).not.toContain(pendingPrompts[1]);
  });

  it("shows a pending call without a child session yet as starting, and keeps the call id once the result lands", () => {
    const parent = lines(fixture("parent.jsonl"))
      .slice(0, 31)
      .reduce((facts, line) => foldParentLine(line, facts), emptyParentFacts());
    const calledAt = Date.parse("2026-10-08T19:58:56.820Z");
    expect(assemble(parent, [], new Map(), [], calledAt + 1_000).agents[0]).toMatchObject({
      status: "running",
      steps: [],
      startedAt: calledAt,
      pending: true,
    });
    const { agents } = assemble(parentFacts(), children(), new Map(), [], NOW);
    expect(agents.find((agent) => agent.agentId === SUBAGENTS_AGENT)).toMatchObject({ callId: "toolu_019Yi49sdKUqFZ8dkuN8Ysdo", pending: false });
  });

  it("drops child sessions outside every workflow window", () => {
    const parent = parentFacts();
    const { agents } = assemble(parent, children(), new Map(), [], NOW);
    expect(agents.map((agent) => agent.workflowId)).toEqual([null, null]);
  });
});
