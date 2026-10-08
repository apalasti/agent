import { beforeEach, describe, expect, it } from "vitest";
import { treeResultSchema, type TreeResult } from "../src/contract";
import { createDiffService, type DiffService } from "../src/service";
import {
  CHECKOUT,
  CHECKOUT_THREAD,
  FakeDiffSdk,
  MemoryScopeStore,
  NO_ENV_THREAD,
  WORKTREE,
  WORKTREE_THREAD,
} from "./fakes";

let sdk: FakeDiffSdk;
let store: MemoryScopeStore;
let service: DiffService;

beforeEach(() => {
  sdk = new FakeDiffSdk();
  store = new MemoryScopeStore();
  service = createDiffService(sdk, store);
});

function available(result: TreeResult) {
  treeResultSchema.parse(result);
  if (result.outcome !== "available") throw new Error(`expected available, got ${result.outcome}: ${result.message}`);
  return result;
}

describe("tree: default scope", () => {
  it("compares the worktree's feature branch with origin/main", async () => {
    const result = available(await service.tree({ threadId: WORKTREE_THREAD, scope: null }));
    expect(result).toMatchObject({
      environmentId: WORKTREE,
      scope: { kind: "all", base: "origin/main" },
      scopeIsDefault: true,
      currentBranch: "rework/solution-page",
      mergeBaseRef: "9a94438ba2e4a423fcd9c9a3dff690917e0411e2",
      truncated: false,
      totals: { files: 76, additions: 3133, deletions: 4256 },
    });
    expect(sdk.callsTo("branches")).toEqual([[WORKTREE, "main"]]);
    expect(sdk.callsTo("files")).toEqual([[WORKTREE, { target: "all", mergeBaseBranch: "origin/main" }]]);
  });

  it("shows uncommitted changes on the default branch without listing branches", async () => {
    const result = available(await service.tree({ threadId: CHECKOUT_THREAD, scope: null }));
    expect(result).toMatchObject({ environmentId: CHECKOUT, scope: { kind: "uncommitted" }, currentBranch: "main" });
    expect(result.files.map((f) => f.path)).toEqual(["skills/show-me/LICENSE", "skills/show-me/SKILL.md"]);
    expect(sdk.callsTo("branches")).toEqual([]);
  });

  it("falls back to the local default branch when the remote branch is missing", async () => {
    sdk.branchLists.set(WORKTREE, { branches: ["main"], branchesTruncated: false, remoteBranches: [], remoteBranchesTruncated: false, selectedBranch: null });
    const result = available(await service.tree({ threadId: WORKTREE_THREAD, scope: null }));
    expect(result.scope).toEqual({ kind: "all", base: "main" });
  });
});

describe("tree: file mapping", () => {
  it("marks untracked and too-large files, keeping on_demand files loadable", async () => {
    const result = available(await service.tree({ threadId: WORKTREE_THREAD, scope: null }));
    expect(result.files.find((f) => f.path === "GLOSSARY.md")).toEqual({
      path: "GLOSSARY.md",
      previousPath: null,
      changeKind: "added",
      additions: 13,
      deletions: 0,
      binary: false,
      untracked: true,
      tooLarge: false,
    });
    expect(result.files.find((f) => f.path === "test/test_solution_shortlist.py")).toMatchObject({
      changeKind: "deleted",
      deletions: 1986,
      tooLarge: false,
    });
    expect(result.files.filter((f) => f.untracked)).toHaveLength(1);
  });

  it("maps loadMode too_large to tooLarge", async () => {
    const fixtureFiles = sdk.fileLists.get(`${WORKTREE} uncommitted`) as Extract<import("../src/service").EnvironmentDiffFilesResult, { outcome: "available" }>;
    sdk.fileLists.set(`${WORKTREE} uncommitted`, { ...fixtureFiles, files: fixtureFiles.files.map((f) => ({ ...f, loadMode: "too_large" as const })) });
    const result = available(await service.tree({ threadId: WORKTREE_THREAD, scope: { kind: "uncommitted" } }));
    expect(result.files[0]?.tooLarge).toBe(true);
  });

  it("passes truncation through and keeps renames and binaries from the capped list", async () => {
    const result = available(await service.tree({ threadId: WORKTREE_THREAD, scope: { kind: "all", base: "main" } }));
    expect(result.truncated).toBe(true);
    expect(result.totals.files).toBe(500);
    const renamed = result.files.filter((f) => f.changeKind === "renamed");
    expect(renamed.length).toBeGreaterThan(0);
    expect(renamed.every((f) => f.previousPath !== null && f.previousPath !== f.path)).toBe(true);
    expect(result.files.find((f) => f.path === "appConfig/ml/environment.dev2/ml.json")).toMatchObject({ binary: true, tooLarge: false });
  });
});

describe("tree: remembered scope", () => {
  it("prefers an explicit scope, then the remembered one, then the default", async () => {
    await store.set(WORKTREE, { kind: "committed", base: "origin/main" });
    const remembered = available(await service.tree({ threadId: WORKTREE_THREAD, scope: null }));
    expect(remembered).toMatchObject({ scope: { kind: "committed", base: "origin/main" }, scopeIsDefault: false, totals: { files: 75 } });
    expect(sdk.callsTo("branches")).toEqual([]);

    const explicit = available(await service.tree({ threadId: WORKTREE_THREAD, scope: { kind: "uncommitted" } }));
    expect(explicit).toMatchObject({ scope: { kind: "uncommitted" }, scopeIsDefault: false, totals: { files: 1 } });
    expect(await store.get(WORKTREE)).toEqual({ kind: "committed", base: "origin/main" });
  });

  it("set_scope remembers per environment and null reverts to the default", async () => {
    const set = available(await service.setScope({ threadId: WORKTREE_THREAD, scope: { kind: "uncommitted" } }));
    expect(set).toMatchObject({ scope: { kind: "uncommitted" }, scopeIsDefault: false });
    expect(available(await service.tree({ threadId: WORKTREE_THREAD, scope: null })).scope).toEqual({ kind: "uncommitted" });
    expect(await store.get(CHECKOUT)).toBeNull();

    const reverted = available(await service.setScope({ threadId: WORKTREE_THREAD, scope: null }));
    expect(reverted).toMatchObject({ scope: { kind: "all", base: "origin/main" }, scopeIsDefault: true });
    expect(await store.get(WORKTREE)).toBeNull();
  });

  it("reports a vanished remembered base as unavailable, naming the base", async () => {
    await store.set(WORKTREE, { kind: "all", base: "feature/gone" });
    const result = treeResultSchema.parse(await service.tree({ threadId: WORKTREE_THREAD, scope: null }));
    expect(result).toMatchObject({ outcome: "unavailable", environmentId: WORKTREE, scope: { kind: "all", base: "feature/gone" } });
    expect(result.outcome !== "available" && result.message).toContain("feature/gone");
  });

  it("treats bb's empty answer for an unknown base as unavailable", async () => {
    const empty = { outcome: "available" as const, files: [], initialPatches: [], shortstat: "", mergeBaseRef: null, truncated: false };
    sdk.fileLists.set(`${WORKTREE} all:feature/gone`, empty);
    sdk.fileLists.set(`${WORKTREE} branch_committed:feature/gone`, empty);
    await store.set(WORKTREE, { kind: "all", base: "feature/gone" });
    expect(await service.tree({ threadId: WORKTREE_THREAD, scope: null })).toEqual({
      outcome: "unavailable",
      environmentId: WORKTREE,
      scope: { kind: "all", base: "feature/gone" },
      message: "No merge base with feature/gone. Does the branch exist?",
    });
    expect(await service.tree({ threadId: WORKTREE_THREAD, scope: { kind: "committed", base: "feature/gone" } })).toMatchObject({
      outcome: "unavailable",
    });
  });

  it("names the base when bb answers unavailable", async () => {
    sdk.fileLists.set(`${WORKTREE} all:feature/gone`, {
      outcome: "unavailable",
      failure: { code: "unknown", message: "fatal: bad revision", workspacePath: "/w" },
    });
    const result = await service.tree({ threadId: WORKTREE_THREAD, scope: { kind: "all", base: "feature/gone" } });
    expect(result).toMatchObject({ outcome: "unavailable", message: "Could not diff against feature/gone: fatal: bad revision" });
  });
});

describe("tree: other outcomes", () => {
  it("reports a thread without an environment", async () => {
    expect(await service.tree({ threadId: NO_ENV_THREAD, scope: null })).toMatchObject({ outcome: "no_environment", environmentId: null });
  });

  it("turns an unknown thread into unavailable instead of throwing", async () => {
    const result = await service.tree({ threadId: "thr_bogus", scope: null });
    expect(result).toMatchObject({ outcome: "unavailable", environmentId: null });
    expect(result.outcome !== "available" && result.message).toContain("thr_bogus");
  });

  it("passes not_applicable through with bb's message", async () => {
    sdk.statuses.set(WORKTREE, { outcome: "not_applicable", reason: "non_git_environment", message: "Not a git repository" });
    expect(await service.tree({ threadId: WORKTREE_THREAD, scope: null })).toMatchObject({ outcome: "not_applicable", message: "Not a git repository" });
    sdk.fileLists.set(`${WORKTREE} uncommitted`, { outcome: "not_applicable", reason: "non_git_environment", message: "Not a git repository" });
    expect(await service.tree({ threadId: WORKTREE_THREAD, scope: { kind: "uncommitted" } })).toMatchObject({ outcome: "not_applicable" });
  });
});

describe("patch", () => {
  it("returns the requested file's patch", async () => {
    const result = await service.patch({ threadId: WORKTREE_THREAD, scope: { kind: "all", base: "origin/main" }, path: "GLOSSARY.md" });
    expect(result).toMatchObject({ outcome: "available", path: "GLOSSARY.md", truncated: false });
    expect(result.outcome === "available" && result.patch).toMatch(/^diff --git a\/GLOSSARY.md/);
    expect(sdk.callsTo("patches")).toEqual([[WORKTREE, { target: "all", mergeBaseBranch: "origin/main" }, ["GLOSSARY.md"]]]);
  });

  it("is unavailable when bb fails, throws, or has no patch for the path", async () => {
    const input = { threadId: WORKTREE_THREAD, scope: { kind: "uncommitted" as const }, path: "missing.ts" };
    expect(await service.patch(input)).toEqual({ outcome: "unavailable", path: "missing.ts", message: "No patch for missing.ts." });
    sdk.patchResult = new Error("boom");
    expect(await service.patch(input)).toEqual({ outcome: "unavailable", path: "missing.ts", message: "boom" });
    sdk.patchResult = { outcome: "unavailable", failure: { code: "unknown", message: "git failed", workspacePath: "/w" } };
    expect(await service.patch(input)).toMatchObject({ outcome: "unavailable", message: "git failed" });
  });
});

describe("branches", () => {
  it("lists local and remote branches for the query", async () => {
    const result = await service.branches({ threadId: CHECKOUT_THREAD, query: "ma" });
    expect(result).toEqual({
      local: ["main", "bb/reply-with-just-ready-thr_a2s2t7wxba", "bb/reply-with-just-ready-thr_bustnvzb7n", "bb/reply-with-just-ready-thr_yzb36a7cmc", "issue-management-redesign", "vscode-extension"],
      remote: ["origin/main"],
      truncated: false,
    });
    expect(sdk.callsTo("branches")).toEqual([[CHECKOUT, "ma"]]);
  });

  it("returns empty lists with a message on failure", async () => {
    expect(await service.branches({ threadId: NO_ENV_THREAD })).toMatchObject({ local: [], remote: [], message: expect.stringContaining("no environment") });
    sdk.branchLists.delete(CHECKOUT);
    expect(await service.branches({ threadId: CHECKOUT_THREAD })).toMatchObject({ local: [], message: `no branches for ${CHECKOUT}` });
  });
});
