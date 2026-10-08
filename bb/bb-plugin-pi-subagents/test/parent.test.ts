import { describe, expect, it } from "vitest";
import { emptyParentFacts, foldParentLine, type ParentFacts } from "../src/parent";
import { DEMO_RUN, LIVE_RUN, SESSION_ID, SUBAGENTS_AGENT, WORKFLOWS_AGENT, fixture, lines } from "./fakes";

const TASKS = `/var/folders/hb/z0645d0501q_35ylknn4gl3c0000gn/T/pi-subagents-501/Users-andraspalasti-fun-agent/${SESSION_ID}/tasks`;

const fold = (text: string, into: ParentFacts = emptyParentFacts()) => lines(text).reduce((facts, line) => foldParentLine(line, facts), into);

describe("foldParentLine", () => {
  const facts = fold(fixture("parent.jsonl"));

  it("reads the header, the lead model and its context", () => {
    expect(facts.header).toEqual({ id: SESSION_ID, cwd: "/Users/andraspalasti/fun/agent", at: Date.parse("2026-10-08T19:52:19.842Z") });
    expect(facts.model).toBe("claude-bridge/claude-opus-5-5");
    expect(facts.context).toBe(2 + 118397 + 2839);
    expect(facts.peakContext).toBe(2 + 118397 + 2839);
  });

  it("collects Agent-tool spawns from their tool results", () => {
    expect([...facts.spawns.values()]).toEqual([
      {
        agentId: SUBAGENTS_AGENT,
        agentType: "Explore",
        description: "Map pi subagent disk footprint",
        modelHint: "sonnet 5.5 1m",
        at: Date.parse("2026-10-08T19:58:58.381Z"),
        toolCallId: "toolu_019Yi49sdKUqFZ8dkuN8Ysdo",
      },
      expect.objectContaining({ agentId: WORKFLOWS_AGENT, description: "Map pi workflow disk footprint" }),
    ]);
  });

  it("collects final records", () => {
    expect(facts.records.get(SUBAGENTS_AGENT)).toEqual({
      status: "completed",
      result: expect.stringMatching(/^Findings below\./),
      error: null,
      startedAt: 1791489536831,
      completedAt: 1791489605599,
    });
    expect(facts.records.size).toBe(2);
  });

  it("collects the workflow completion notification by run id", () => {
    expect([...facts.notifications.entries()]).toEqual([
      [DEMO_RUN, { status: "completed", totalTokens: 87842, durationMs: 24477, error: null }],
    ]);
  });

  it("collects workflow launches with their script path", () => {
    expect([...facts.workflows.values()]).toEqual([
      { runId: DEMO_RUN, scriptPath: `${TASKS}/${DEMO_RUN}.workflow.js`, at: Date.parse("2026-10-08T19:52:56.351Z") },
      { runId: LIVE_RUN, scriptPath: `${TASKS}/${LIVE_RUN}.workflow.js`, at: Date.parse("2026-10-08T20:13:52.883Z") },
    ]);
  });

  it("reads every agent of a grouped notification and keeps an agent's first spawn", () => {
    const notification = JSON.stringify({
      type: "custom_message",
      customType: "subagent-notification",
      timestamp: "2026-10-08T20:00:00Z",
      details: {
        id: "a1",
        status: "error",
        totalTokens: 10,
        durationMs: 5,
        error: "boom",
        others: [{ id: "a2", status: "steered", totalTokens: 20, durationMs: 6 }],
      },
    });
    const resumed = JSON.stringify({
      type: "message",
      timestamp: "2026-10-08T21:00:00Z",
      message: { role: "toolResult", toolName: "Agent", toolCallId: "late", content: [], details: { agentId: SUBAGENTS_AGENT, description: "resumed" } },
    });
    const more = fold([notification, resumed, "{partial"].join("\n"), fold(fixture("parent.jsonl")));
    expect(more.notifications.get("a1")).toEqual({ status: "error", totalTokens: 10, durationMs: 5, error: "boom" });
    expect(more.notifications.get("a2")).toEqual({ status: "steered", totalTokens: 20, durationMs: 6, error: null });
    expect(more.spawns.get(SUBAGENTS_AGENT)?.description).toBe("Map pi subagent disk footprint");
  });

  it("falls back to the result text for the description and type", () => {
    const result = JSON.stringify({
      type: "message",
      timestamp: "2026-10-08T21:00:00Z",
      message: {
        role: "toolResult",
        toolName: "Agent",
        toolCallId: "c1",
        content: [{ type: "text", text: "Agent started in background.\nAgent ID: b1\nType: Plan\nDescription: Plan the work\n" }],
        details: { agentId: "b1" },
      },
    });
    expect(fold(result).spawns.get("b1")).toMatchObject({ agentType: "Plan", description: "Plan the work", modelHint: null });
  });
});
