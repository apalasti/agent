import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin, { createDiffSignal } from "../server";
import { DIFF_CHANGED, branchesResultSchema, patchResultSchema, treeResultSchema } from "../src/contract";
import type { DiffTarget } from "../src/scope";
import { FakeDiffSdk, WORKTREE, WORKTREE_THREAD } from "./fakes";

async function load() {
  const fake = new FakeDiffSdk();
  const { bb, harness } = createFakePluginHost({
    pluginId: "difftree",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          const environmentId = await fake.environmentIdOf(threadId);
          return makeThreadResponse({ id: threadId, environmentId });
        },
      },
      environments: {
        status: ({ environmentId }: { environmentId: string }) => fake.status(environmentId),
        diffBranches: ({ environmentId, query }: { environmentId: string; query?: string }) => fake.branches(environmentId, query),
        diffFiles: ({ environmentId, ...target }: { environmentId: string } & DiffTarget) => fake.files(environmentId, target),
        diffPatch: () => fake.patchResult,
      },
    } as never,
  });
  await plugin(bb);
  return { harness, fake };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("rpc", () => {
  it("serves tree, set_scope, branches and patch through the contract", async () => {
    const { harness } = await load();
    const tree = treeResultSchema.parse(await harness.behavior.callRpc("tree", { threadId: WORKTREE_THREAD, scope: null }));
    expect(tree).toMatchObject({ outcome: "available", scope: { kind: "all", base: "origin/main" }, scopeIsDefault: true });

    const set = treeResultSchema.parse(await harness.behavior.callRpc("set_scope", { threadId: WORKTREE_THREAD, scope: { kind: "uncommitted" } }));
    expect(set).toMatchObject({ outcome: "available", scope: { kind: "uncommitted" }, scopeIsDefault: false, totals: { files: 1 } });
    expect(await harness.behavior.callRpc("tree", { threadId: WORKTREE_THREAD, scope: null })).toMatchObject({ scope: { kind: "uncommitted" } });
    await harness.behavior.callRpc("set_scope", { threadId: WORKTREE_THREAD, scope: null });
    expect(await harness.behavior.callRpc("tree", { threadId: WORKTREE_THREAD, scope: null })).toMatchObject({ scopeIsDefault: true });

    const branches = branchesResultSchema.parse(await harness.behavior.callRpc("branches", { threadId: WORKTREE_THREAD, query: "main" }));
    expect(branches.remote[0]).toBe("origin/main");

    const patch = patchResultSchema.parse(
      await harness.behavior.callRpc("patch", { threadId: WORKTREE_THREAD, scope: { kind: "committed", base: "origin/main" }, path: "GLOSSARY.md" }),
    );
    expect(patch.outcome).toBe("available");
    expect(harness.inspection.sdk.callsTo("environments.diffPatch")[0]).toEqual([
      { environmentId: WORKTREE, paths: ["GLOSSARY.md"], target: { type: "branch_committed", mergeBaseBranch: "origin/main" } },
    ]);
    await harness.behavior.callRpc("patch", { threadId: WORKTREE_THREAD, scope: { kind: "uncommitted" }, path: "GLOSSARY.md" });
    expect(harness.inspection.sdk.callsTo("environments.diffPatch")[1]).toEqual([
      { environmentId: WORKTREE, paths: ["GLOSSARY.md"], target: { type: "uncommitted" } },
    ]);
  });

  it("answers an unknown thread with an outcome, not an rpc error", async () => {
    const { harness } = await load();
    expect(await harness.behavior.callRpc("tree", { threadId: "thr_bogus", scope: null })).toMatchObject({ outcome: "unavailable" });
  });
});

describe("cli", () => {
  it("prints the calling thread's tree", async () => {
    const { harness } = await load();
    const result = await harness.behavior.runCli([], { threadId: WORKTREE_THREAD });
    expect(result.exitCode).toBe(0);
    expect(String(result.stdout).split("\n")[0]).toBe("rework/solution-page · All changes vs origin/main · 76 files +3133 -4256");
  });

  it("applies scope flags for one call without remembering them", async () => {
    const { harness, fake } = await load();
    const committed = await harness.behavior.runCli([WORKTREE_THREAD, "--base", "origin/main", "--committed", "--depth", "1"]);
    expect(String(committed.stdout).split("\n")[0]).toBe("rework/solution-page · Commits vs origin/main · 75 files +3120 -4256");
    expect(String(committed.stdout).split("\n")).toHaveLength(1 + 11 + 1);
    const uncommitted = await harness.behavior.runCli([WORKTREE_THREAD, "--uncommitted"]);
    expect(String(uncommitted.stdout)).toBe(
      "rework/solution-page · Uncommitted · 1 file +13 -0\n? GLOSSARY.md  +13 -0\n",
    );
    await harness.behavior.runCli([WORKTREE_THREAD]);
    expect(fake.callsTo("files").at(-1)).toEqual([WORKTREE, { target: "all", mergeBaseBranch: "origin/main" }]);
  });

  it("prints the TreeResult with --json", async () => {
    const { harness } = await load();
    const result = await harness.behavior.runCli([WORKTREE_THREAD, "--json"]);
    const parsed = treeResultSchema.parse(JSON.parse(String(result.stdout)));
    expect(parsed.outcome === "available" && parsed.files).toHaveLength(76);
  });

  it("fails clearly without a thread, on an unknown thread, and on a bad base", async () => {
    const { harness } = await load();
    const missing = await harness.behavior.runCli([]);
    expect(missing.exitCode).not.toBe(0);
    expect(String(missing.stderr)).toContain("No thread given");
    expect(String(missing.stderr)).toContain("bb difftree <thread-id>");

    const bogus = await harness.behavior.runCli(["thr_bogus"]);
    expect(bogus.exitCode).not.toBe(0);
    expect(String(bogus.stderr)).toContain("thr_bogus");

    const badBase = await harness.behavior.runCli([WORKTREE_THREAD, "--base", "nope/branch"]);
    expect(badBase.exitCode).not.toBe(0);
    expect(String(badBase.stderr)).toContain("nope/branch");

    const conflicting = await harness.behavior.runCli([WORKTREE_THREAD, "--uncommitted", "--base", "main"]);
    expect(conflicting.exitCode).not.toBe(0);
    const orphan = await harness.behavior.runCli([WORKTREE_THREAD, "--committed"]);
    expect(orphan.exitCode).not.toBe(0);
  });
});

describe("live refresh", () => {
  const event = (environmentId: string | null) => ({ thread: makeThreadResponse({ id: "thr_x", environmentId }), sequence: 1 });

  it("throttles thread events to one signal per environment per 4 s, keeping the trailing change", async () => {
    vi.useFakeTimers();
    const { harness } = await load();
    const signals = () => harness.inspection.realtimeSignals.filter((s) => s.channel === DIFF_CHANGED);

    await harness.behavior.emitThreadEvent("experimental_thread.events", event(WORKTREE));
    expect(signals()).toEqual([{ channel: DIFF_CHANGED, payload: { environmentId: WORKTREE } }]);
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1_000);
      await harness.behavior.emitThreadEvent("experimental_thread.events", event(WORKTREE));
    }
    await harness.behavior.emitThreadEvent("experimental_thread.events", event("env_other"));
    expect(signals()).toHaveLength(2);
    vi.advanceTimersByTime(999);
    expect(signals()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(signals()).toHaveLength(3);
    expect(signals()[2]).toEqual({ channel: DIFF_CHANGED, payload: { environmentId: WORKTREE } });
    vi.advanceTimersByTime(10_000);
    expect(signals()).toHaveLength(3);

    await harness.behavior.emitThreadEvent("experimental_thread.events", event(null));
    expect(signals()).toHaveLength(3);
  });

  it("signals immediately on thread.idle and drops the pending trailing signal", async () => {
    vi.useFakeTimers();
    const { harness } = await load();
    const signals = () => harness.inspection.realtimeSignals.filter((s) => s.channel === DIFF_CHANGED);
    await harness.behavior.emitThreadEvent("experimental_thread.events", event(WORKTREE));
    await harness.behavior.emitThreadEvent("experimental_thread.events", event(WORKTREE));
    await harness.behavior.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "thr_x", environmentId: WORKTREE }), lastAssistantText: null });
    expect(signals()).toHaveLength(2);
    vi.advanceTimersByTime(10_000);
    expect(signals()).toHaveLength(2);
  });

  it("clears pending timers on dispose", () => {
    vi.useFakeTimers();
    const published: string[] = [];
    const signal = createDiffSignal(({ environmentId }) => published.push(environmentId));
    signal.changed("env_a");
    signal.changed("env_a");
    signal.dispose();
    vi.advanceTimersByTime(10_000);
    expect(published).toEqual(["env_a"]);
  });
});
