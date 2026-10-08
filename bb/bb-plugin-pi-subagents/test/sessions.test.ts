import { appendFile, readFile, rename, rm, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionStore, encodeCwd, sessionDirName } from "../src/sessions";
import {
  DEMO_CHILD_SESSION,
  DEMO_RUN,
  LIVE_RUN,
  PROVIDER_THREAD_ID,
  SUBAGENTS_AGENT,
  SUBAGENTS_SESSION,
  UID,
  seedDisk,
  type Layout,
} from "./fakes";

let layout: Layout;

const store = () => createSessionStore({ bridgeDir: layout.bridgeDir, piSessions: layout.piSessions, tmp: layout.tmp, uid: UID });

beforeEach(async () => {
  layout = await seedDisk();
});

afterEach(async () => {
  await rm(layout.root, { recursive: true, force: true });
});

describe("path encodings", () => {
  it("matches pi's session dir and pi-subagents' task dir names", () => {
    expect(sessionDirName("/Users/andraspalasti/fun/agent")).toBe("--Users-andraspalasti-fun-agent--");
    expect(encodeCwd("/Users/andraspalasti/fun/agent")).toBe("Users-andraspalasti-fun-agent");
    expect(encodeCwd("C:\\w\\x")).toBe("w-x");
  });
});

describe("createSessionStore", () => {
  it("reads the parent, its child sessions and its workflow files", async () => {
    const thread = await store().readThread(PROVIDER_THREAD_ID);
    expect(thread?.parentPath).toBe(layout.parentPath);
    expect(thread?.parent.spawns.size).toBe(2);
    expect(thread?.children.map((child) => child.transcript.name).sort()).toEqual([
      "Explore#4f3c9ead",
      "Explore#5c64547e",
      "Explore#6c45e43b",
      "Explore#91186f5e",
      "Explore#9a764027",
      "Explore#ca7df9fa",
      "Explore#efc70e1f",
      "Explore#ff796ad3",
      "general-purpose#4563ed95",
      "general-purpose#f7332955",
    ]);
    expect(thread?.children.every((child) => child.mtimeMs > 0)).toBe(true);
    expect(thread?.outputs.size).toBe(0);
    expect(thread?.workflows.map((workflow) => [workflow.launch.runId, workflow.meta.name, workflow.journal.done])).toEqual([
      [DEMO_RUN, "demo-repo-tour", 7],
      [LIVE_RUN, "migrate-bb-plugins-to-pi", 0],
    ]);
    expect(thread?.workflows[0]?.journalMtimeMs).toBeGreaterThan(0);
    expect(thread?.workflows[1]?.journalMtimeMs).toBeNull();
  });

  it("skips sessions of other parents and sessions older than the parent", async () => {
    const other = (await store().readThread(PROVIDER_THREAD_ID))?.children.map((child) => child.path) ?? [];
    expect(other.some((path) => path.includes("2026-10-07T20-08-04"))).toBe(false);
  });

  it("reads an agent's .output file when it has no child session", async () => {
    await rm(join(layout.childDir, SUBAGENTS_SESSION));
    const thread = await store().readThread(PROVIDER_THREAD_ID);
    expect([...(thread?.outputs.keys() ?? [])]).toEqual([SUBAGENTS_AGENT]);
    expect(thread?.outputs.get(SUBAGENTS_AGENT)?.transcript.totalTokens).toBe(49949);
  });

  it("returns null for a missing parent, an empty parent or an unsafe id", async () => {
    expect(await store().readThread("pi_missing")).toBeNull();
    expect(await store().readThread("../bridge/pi_e6c62b6b-9ba7-4f95-85af-6183a2877e86")).toBeNull();
    await writeFile(join(layout.bridgeDir, "pi_empty.jsonl"), "");
    expect(await store().readThread("pi_empty")).toBeNull();
  });

  it("returns no children when the session dir is missing", async () => {
    await rm(layout.childDir, { recursive: true });
    expect((await store().readThread(PROVIDER_THREAD_ID))?.children).toEqual([]);
  });

  it("folds only appended complete lines of the parent and restarts when it shrinks", async () => {
    const sessions = store();
    const first = await sessions.readThread(PROVIDER_THREAD_ID);
    const record = JSON.stringify({ type: "custom", customType: "subagents:record", data: { id: "late-agent", status: "completed" } });
    await appendFile(layout.parentPath, record.slice(0, 20));
    expect((await sessions.readThread(PROVIDER_THREAD_ID))?.parent.records.has("late-agent")).toBe(false);
    await appendFile(layout.parentPath, `${record.slice(20)}\n`);
    const grown = await sessions.readThread(PROVIDER_THREAD_ID);
    expect(grown?.parent).toBe(first?.parent);
    expect(grown?.parent.records.has("late-agent")).toBe(true);

    const text = await readFile(layout.parentPath, "utf8");
    await truncate(layout.parentPath, text.indexOf("\n") + 1);
    const shrunk = await sessions.readThread(PROVIDER_THREAD_ID);
    expect(shrunk?.parent.records.size).toBe(0);
    expect(shrunk?.parent.header?.id).toBe("01a11d12-e481-771f-b48d-2541fad34b6a");
  });

  it("reuses a child's parse while unchanged and reparses after it grows", async () => {
    const sessions = store();
    const transcriptOf = async () =>
      (await sessions.readThread(PROVIDER_THREAD_ID))?.children.find((child) => child.path.endsWith(DEMO_CHILD_SESSION))?.transcript;
    const first = await transcriptOf();
    expect(await transcriptOf()).toBe(first);
    const line = JSON.stringify({ type: "message", timestamp: "2026-10-08T19:53:05Z", message: { role: "assistant", content: [{ type: "text", text: "one more" }] } });
    await appendFile(join(layout.childDir, DEMO_CHILD_SESSION), `${line}\n`);
    const third = await transcriptOf();
    expect(third).not.toBe(first);
    expect(third?.report).toBe("one more");
  });

  it("finds a child session that appears after the first read", async () => {
    const sessions = store();
    const moved = join(layout.root, DEMO_CHILD_SESSION);
    await rename(join(layout.childDir, DEMO_CHILD_SESSION), moved);
    expect((await sessions.readThread(PROVIDER_THREAD_ID))?.children).toHaveLength(9);
    await rename(moved, join(layout.childDir, DEMO_CHILD_SESSION));
    expect((await sessions.readThread(PROVIDER_THREAD_ID))?.children).toHaveLength(10);
  });
});
