import { appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionStore } from "../src/sessions";
import { ERRORS_AGENT, SESSION_ID, WRITES_AGENT, seedProjects } from "./fakes";

let layout: Awaited<ReturnType<typeof seedProjects>>;

beforeEach(async () => {
  layout = await seedProjects();
});

afterEach(async () => {
  await rm(layout.root, { recursive: true, force: true });
});

describe("createSessionStore", () => {
  it("finds the project dir holding the session transcript", async () => {
    const store = createSessionStore(layout.root);
    expect(await store.findSessionDir(SESSION_ID)).toBe(layout.sessionDir);
    expect(await store.findSessionDir("missing")).toBeNull();
  });

  it("returns nothing for a missing projects root", async () => {
    expect(await createSessionStore(join(layout.root, "nope")).findSessionDir(SESSION_ID)).toBeNull();
  });

  it("reads the lead transcript without sidechain lines", async () => {
    const lead = await createSessionStore(layout.root).readLead(layout.sessionDir, SESSION_ID);
    expect(lead?.model).toBe("claude-opus-5-5");
    expect(await createSessionStore(layout.root).readLead(layout.sessionDir, "missing")).toBeNull();
  });

  it("reads every agent with its meta and transcript", async () => {
    const sources = await createSessionStore(layout.root).readAgents(layout.sessionDir, SESSION_ID);
    const byId = new Map(sources.map((source) => [source.agentId, source]));
    expect([...byId.keys()].sort()).toEqual([ERRORS_AGENT, WRITES_AGENT].sort());
    expect(byId.get(WRITES_AGENT)?.meta).toMatchObject({ description: "Draft scratch notes file", model: "haiku" });
    expect(byId.get(ERRORS_AGENT)?.transcript.handedBack).toBe(true);
    expect(byId.get(WRITES_AGENT)?.mtimeMs).toBeGreaterThan(0);
  });

  it("uses empty meta when the meta file is missing", async () => {
    await rm(join(layout.subagents, `agent-${WRITES_AGENT}.meta.json`));
    const sources = await createSessionStore(layout.root).readAgents(layout.sessionDir, SESSION_ID);
    expect(sources.find((source) => source.agentId === WRITES_AGENT)?.meta).toEqual({});
  });

  it("returns no agents when the session has no subagents dir", async () => {
    await rm(join(layout.sessionDir, SESSION_ID), { recursive: true });
    expect(await createSessionStore(layout.root).readAgents(layout.sessionDir, SESSION_ID)).toEqual([]);
  });

  it("reuses the parse for an unchanged file and reparses after it grows", async () => {
    const store = createSessionStore(layout.root);
    const first = await store.readAgents(layout.sessionDir, SESSION_ID);
    const second = await store.readAgents(layout.sessionDir, SESSION_ID);
    const transcriptOf = (sources: typeof first) => sources.find((source) => source.agentId === WRITES_AGENT)?.transcript;
    expect(transcriptOf(second)).toBe(transcriptOf(first));

    const text = JSON.stringify({ type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "one more" }] } });
    await appendFile(join(layout.subagents, `agent-${WRITES_AGENT}.jsonl`), `${text}\n`);
    const third = await store.readAgents(layout.sessionDir, SESSION_ID);
    expect(transcriptOf(third)).not.toBe(transcriptOf(first));
    expect(transcriptOf(third)?.steps.at(-1)?.summary).toBe("one more");
  });
});
