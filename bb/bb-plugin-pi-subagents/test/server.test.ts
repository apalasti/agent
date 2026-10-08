import { rm } from "node:fs/promises";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlugin } from "../server";
import type { ThreadAgents } from "../src/contract";
import type { EventRow } from "../src/events";
import { createSessionStore } from "../src/sessions";
import { DEMO_RUN, LIVE_RUN, PROVIDER_THREAD_ID, SESSION_ID, SUBAGENTS_AGENT, UID, WORKFLOWS_AGENT, seedDisk, type Layout } from "./fakes";

const THREAD = "thr_yvvz3re3yb";
const NOW = Date.parse("2026-10-08T21:00:00Z");

const identity = (seq: number, providerThreadId = PROVIDER_THREAD_ID): EventRow => ({
  seq,
  type: "thread/identity",
  createdAt: NOW,
  data: { providerThreadId },
});
const noise = (seq: number): EventRow => ({ seq, type: "item/started", createdAt: NOW, data: { item: { type: "message" } } });

let layout: Layout;
let events: EventRow[];
let listCalls: string[];
let gate: Promise<void> | null;

async function load() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "pi-subagents",
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
  const store = createSessionStore({ bridgeDir: layout.bridgeDir, piSessions: layout.piSessions, tmp: layout.tmp, uid: UID });
  await createPlugin(store, () => NOW)(bb);
  return (threadId = THREAD) => harness.behavior.callRpc("threadAgents", { threadId }) as Promise<ThreadAgents>;
}

const EMPTY: ThreadAgents = { sessionId: null, cwd: null, environmentId: null, lead: null, agents: [], workflows: [] };

beforeEach(async () => {
  layout = await seedDisk();
  events = [identity(16)];
  listCalls = [];
  gate = null;
});

afterEach(async () => {
  await rm(layout.root, { recursive: true, force: true });
});

describe("threadAgents", () => {
  it("joins the parent session, child sessions, workflow files and the thread environment", async () => {
    const result = await (await load())();
    expect(result).toMatchObject({
      sessionId: SESSION_ID,
      cwd: "/Users/me/agent",
      environmentId: "env_1",
      lead: { model: "claude-bridge/claude-opus-5-5", context: 121238, contextWindow: 200_000 },
    });
    const topLevel = result.agents.filter((agent) => agent.workflowId === null);
    expect(topLevel.map((agent) => [agent.agentId, agent.status, agent.totalTokens])).toEqual([
      [SUBAGENTS_AGENT, "done", 49949],
      [WORKFLOWS_AGENT, "done", 54360],
    ]);
    expect(result.agents.filter((agent) => agent.workflowId === DEMO_RUN)).toHaveLength(7);
    expect(result.workflows.map((workflow) => [workflow.runId, workflow.status, workflow.done])).toEqual([
      [DEMO_RUN, "done", 7],
      [LIVE_RUN, "unknown", 0],
    ]);
  });

  it("returns an empty result when the thread has no pi session", async () => {
    events = [];
    expect(await (await load())()).toEqual(EMPTY);
  });

  it("returns an empty result when the session file is not on disk", async () => {
    events = [identity(16, "pi_gone")];
    expect(await (await load())()).toEqual(EMPTY);
  });

  it("pages through events and resumes after the last seen seq", async () => {
    events = [identity(16), ...Array.from({ length: 150 }, (_, i) => identity(2_000 + i))];
    const call = await load();
    await call();
    expect(listCalls).toEqual(["0", "2098"]);
    listCalls = [];
    await call();
    expect(listCalls).toEqual(["2149"]);
  });

  it("folds a thread's events one poll at a time when the pill and panel poll together", async () => {
    events = [noise(1)];
    let release!: () => void;
    gate = new Promise((resolve) => (release = resolve));
    const call = await load();
    const first = call();
    await vi.waitFor(() => expect(listCalls).toHaveLength(1));
    events = [noise(1), identity(16)];
    const second = call();
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    expect(await first).toEqual(EMPTY);
    expect((await second).sessionId).toBe(SESSION_ID);
    listCalls = [];
    await call();
    expect(listCalls).toEqual(["16"]);
  });
});
