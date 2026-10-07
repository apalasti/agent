import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { BranchesResult, ChangedFile, PatchResult, rpcContract, Scope, TreeResult } from "../../src/contract";

interface ApiFile {
  path: string;
  previousPath: string | null;
  changeKind: ChangedFile["changeKind"];
  additions: number;
  deletions: number;
  binary: boolean;
  origin: "tracked" | "untracked";
  loadMode: string;
}

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

export function filesOf(name: string): ChangedFile[] {
  return readFixture<{ files: ApiFile[] }>(name).files.map((file) => ({
    path: file.path,
    previousPath: file.previousPath,
    changeKind: file.changeKind,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
    untracked: file.origin === "untracked",
    tooLarge: file.loadMode === "too_large",
  }));
}

export const ENV = "env_nu8k8jjdu3";
export const ORIGIN_MAIN: Scope = { kind: "all", base: "origin/main" };

export function available(files: ChangedFile[], overrides: Partial<Extract<TreeResult, { outcome: "available" }>> = {}): TreeResult {
  return {
    outcome: "available",
    environmentId: ENV,
    scope: ORIGIN_MAIN,
    scopeIsDefault: true,
    currentBranch: "rework/solution-page",
    mergeBaseRef: "9a94438ba2e4a423fcd9c9a3dff690917e0411e2",
    files,
    truncated: false,
    totals: {
      files: files.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
    ...overrides,
  };
}

export const NU_FILES = filesOf("nu.all-origin-main.json");
export const NU_TREE = available(NU_FILES);
export const TRUNCATED_TREE = available(filesOf("nu.all-main-truncated.json"), {
  scope: { kind: "all", base: "main" },
  scopeIsDefault: false,
  truncated: true,
});

const PATCHES = readFixture<{ patches: { path: string; patch: string; truncated?: boolean }[] }>("nu.patch.json").patches;

export function patchFor(path: string): PatchResult {
  const found = PATCHES.find((patch) => patch.path === path);
  if (!found) return { outcome: "unavailable", path, message: `no fixture patch for ${path}` };
  return { outcome: "available", path, patch: found.patch, truncated: found.truncated ?? false };
}

interface ApiBranches {
  branches: string[];
  branchesTruncated: boolean;
  remoteBranches: string[];
}

export function branchesFixture(): BranchesResult {
  const raw = readFixture<ApiBranches>("nu.branches-main.json");
  return { local: raw.branches, remote: raw.remoteBranches, truncated: raw.branchesTruncated };
}

export function rpcHandlers(
  overrides: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {},
): PluginRpcTestHandlers<typeof rpcContract> {
  const unused = (method: string) => () => {
    throw new Error(`unexpected rpc ${method}`);
  };
  return {
    tree: unused("tree"),
    patch: unused("patch"),
    branches: unused("branches"),
    set_scope: unused("set_scope"),
    ...overrides,
  };
}
