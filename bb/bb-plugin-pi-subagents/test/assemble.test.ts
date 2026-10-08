import { describe, expect, it } from "vitest";
import { assembleAgents, deriveStatus, type AgentSource } from "../src/assemble";
import type { TaskFacts } from "../src/events";
import { parseTranscript, type Transcript } from "../src/transcript";
import { fixture } from "./fakes";

const NOW = 1_000_000_000;
const QUIET = NOW - 120_000;

function transcript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    prompt: "do it",
    steps: [],
    toolUseIds: new Set(),
    report: null,
    handedBack: false,
    files: [],
    model: null,
    context: 0,
    peakContext: 0,
    firstAt: null,
    lastAt: null,
    endedTurn: false,
    ...overrides,
  };
}

const source = (overrides: Partial<Transcript> = {}, mtimeMs = QUIET, agentId = "a1", toolUseId?: string): AgentSource => ({
  agentId,
  meta: { description: `task ${agentId}`, agentType: "Explore", toolUseId },
  transcript: transcript(overrides),
  mtimeMs,
});

const task = (status: string, overrides: Partial<TaskFacts> = {}): TaskFacts => ({
  status,
  startedAt: NOW - 60_000,
  endedAt: status === "running" ? null : NOW - 10_000,
  totalTokens: null,
  ...overrides,
});

describe("deriveStatus", () => {
  it("is done when the task completed with a report", () => {
    expect(deriveStatus(source({ report: "All good" }), task("completed"), NOW)).toBe("done");
  });

  it("needs a look when the task completed without a report", () => {
    expect(deriveStatus(source(), task("completed"), NOW)).toBe("needs-look");
    expect(deriveStatus(source({ report: "  \n" }), task("completed"), NOW)).toBe("needs-look");
  });

  it("is finished on a handback even while the task still says running", () => {
    expect(deriveStatus(source({ handedBack: true, report: "Report" }, NOW), task("running"), NOW)).toBe("done");
  });

  it.each(["failed", "killed"])("is failed when the task %s", (status) => {
    expect(deriveStatus(source({ report: "partial" }), task(status), NOW)).toBe("failed");
  });

  it("is running while the task runs, even with a quiet transcript", () => {
    expect(deriveStatus(source(), task("running"), NOW)).toBe("running");
  });

  it("is running without a task when the transcript changed within 90s", () => {
    expect(deriveStatus(source({ endedTurn: true }, NOW - 89_000), undefined, NOW)).toBe("running");
  });

  it("is finished without a task when the transcript is idle after end_turn", () => {
    expect(deriveStatus(source({ endedTurn: true, report: "Done" }), undefined, NOW)).toBe("done");
    expect(deriveStatus(source({ endedTurn: true }), undefined, NOW)).toBe("needs-look");
  });

  it("is unknown without a task when the transcript is idle mid-turn", () => {
    expect(deriveStatus(source(), undefined, NOW)).toBe("unknown");
  });
});

describe("assembleAgents", () => {
  it("joins meta, a real transcript and task facts into an agent", () => {
    const real: AgentSource = {
      agentId: "a2baef7967d8bccd4",
      meta: JSON.parse(fixture("subagent-writes.meta.json")),
      transcript: parseTranscript(fixture("subagent-writes.jsonl"), { sidechain: true }),
      mtimeMs: QUIET,
    };
    const [agent] = assembleAgents([real], new Map([[real.agentId, task("completed", { totalTokens: 27357 })]]), NOW);
    expect(agent).toMatchObject({
      agentId: "a2baef7967d8bccd4",
      parentAgentId: null,
      description: "Draft scratch notes file",
      agentType: "general-purpose",
      model: "claude-haiku-5-5",
      status: "done",
      startedAt: Date.parse("2026-10-08T16:18:35.022Z"),
      endedAt: NOW - 10_000,
      errors: 0,
      totalTokens: 27357,
      context: 27122,
      contextWindow: 200_000,
    });
    expect(agent?.report).toMatch(/^The scratch file is at/);
  });

  it("falls back to meta and the transcript when facts are missing", () => {
    const bare: AgentSource = { agentId: "a9", meta: { model: "haiku" }, transcript: transcript({ lastAt: NOW - 5_000 }), mtimeMs: QUIET };
    expect(assembleAgents([bare], new Map(), NOW)[0]).toMatchObject({
      description: "a9",
      agentType: "agent",
      model: "haiku",
      status: "unknown",
      startedAt: null,
      endedAt: NOW - 5_000,
      totalTokens: null,
    });
  });

  it("has no end while running and counts failed steps", () => {
    const failedStep = { at: 1, endAt: 2, kind: "tool" as const, name: "Bash", summary: "false", input: "{}", result: "Exit code 1", isError: true };
    const [agent] = assembleAgents([source({ steps: [failedStep], lastAt: NOW })], new Map([["a1", task("running")]]), NOW);
    expect(agent).toMatchObject({ status: "running", endedAt: null, errors: 1, startedAt: NOW - 60_000 });
  });

  it("links a nested agent to the agent whose tool call launched it", () => {
    const parent = source({ toolUseIds: new Set(["toolu_child"]), firstAt: 1 }, QUIET, "parent");
    const child = source({ firstAt: 2 }, QUIET, "child", "toolu_child");
    const orphan = source({ firstAt: 3 }, QUIET, "orphan", "toolu_from_lead");
    expect(assembleAgents([parent, child, orphan], new Map(), NOW).map((agent) => [agent.agentId, agent.parentAgentId])).toEqual([
      ["parent", null],
      ["child", "parent"],
      ["orphan", null],
    ]);
  });

  it("sorts by start time", () => {
    const late = source({ firstAt: 300 }, QUIET, "late");
    const early = source({ firstAt: 100 }, QUIET, "early");
    expect(assembleAgents([late, early], new Map(), NOW).map((agent) => agent.agentId)).toEqual(["early", "late"]);
  });
});
