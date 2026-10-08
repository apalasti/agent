import { rm } from "node:fs/promises";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlugin } from "../server";
import type { ThreadAgents } from "../src/contract";
import type { EventRow } from "../src/events";
import { createSessionStore } from "../src/sessions";
import { ERRORS_AGENT, SESSION_ID, WRITES_AGENT, fixtureEvents, seedProjects } from "./fakes";

const THREAD = "thr_yvvz3re3yb";
const NOW = Date.parse("2026-10-08T20:00:00Z");

let layout: Awaited<ReturnType<typeof seedProjects>>;
let events: EventRow[];
let listCalls: string[];
let gate: Promise<void> | null;

async function load() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "claude-subagents",
    sdk: {
      threads: {
        events: {
          list: async ({ afterSeq, limit, types }: { afterSeq: string; limit: string; types: string[] }) => {
            listCalls.push(afterSeq);
            const snapshot = events;
            const wait = gate;
            gate = null;
            await wait;
            return snapshot
              .filter((row) => Number(row.seq) > Number(afterSeq) && types.includes(row.type))
              .slice(0, Number(limit));
          },
        },
        get: async () => ({ id: THREAD, environment: { id: "env_1", path: "/Users/me/agent" } }),
      },
    } as never,
  });
  await createPlugin(createSessionStore(layout.root), () => NOW)(bb);
  return (threadId = THREAD) => harness.behavior.callRpc("threadAgents", { threadId }) as Promise<ThreadAgents>;
}

beforeEach(async () => {
  layout = await seedProjects();
  events = fixtureEvents();
  listCalls = [];
  gate = null;
});

afterEach(async () => {
  await rm(layout.root, { recursive: true, force: true });
});

describe("threadAgents", () => {
  it("joins events, the lead and subagent transcripts and the thread environment", async () => {
    const result = await (await load())();
    expect(result).toMatchObject({
      sessionId: SESSION_ID,
      cwd: "/Users/me/agent",
      environmentId: "env_1",
      lead: { model: "claude-opus-5-5", context: 69858, contextWindow: 200_000 },
    });
    expect(result.agents.map((agent) => [agent.agentId, agent.status, agent.totalTokens])).toEqual([
      [WRITES_AGENT, "done", 27357],
      [ERRORS_AGENT, "done", null],
    ]);
  });

  it("returns an empty result when the thread has no Claude session", async () => {
    events = events.filter((row) => row.type !== "thread/identity");
    expect(await (await load())()).toEqual({ sessionId: null, cwd: null, environmentId: null, lead: null, agents: [] });
  });

  it("returns an empty result when the session transcript is not on disk", async () => {
    await rm(layout.sessionDir, { recursive: true });
    expect(await (await load())()).toEqual({ sessionId: SESSION_ID, cwd: null, environmentId: null, lead: null, agents: [] });
  });

  it("pages through events and resumes after the last seen seq", async () => {
    const extra: EventRow[] = Array.from({ length: 150 }, (_, i) => ({
      seq: 2_000 + i,
      type: "item/started",
      createdAt: NOW,
      data: { item: { type: "message" } },
    }));
    events = [...events, ...extra];
    const call = await load();
    await call();
    expect(listCalls).toEqual(["0", "2091"]);
    listCalls = [];
    await call();
    expect(listCalls).toEqual(["2149"]);
  });

  it("folds a thread's events one poll at a time when the pill and panel poll together", async () => {
    const all = events;
    events = all.filter((row) => Number(row.seq) <= 426);
    let release!: () => void;
    gate = new Promise((resolve) => (release = resolve));
    const call = await load();
    const first = call();
    await vi.waitFor(() => expect(listCalls).toHaveLength(1));
    events = all;
    const second = call();
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await first;
    const latest = await second;
    expect(latest.agents.find((agent) => agent.agentId === WRITES_AGENT)?.status).toBe("done");
    listCalls = [];
    await call();
    expect(listCalls).toEqual(["566"]);
  });
});
