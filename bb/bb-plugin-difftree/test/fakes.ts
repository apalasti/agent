import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChangedFile, Scope } from "../src/contract";
import type { DiffTarget } from "../src/scope";
import type {
  DiffSdk,
  EnvironmentDiffBranchesResult,
  EnvironmentDiffFilesResult,
  EnvironmentDiffPatchResult,
  EnvironmentStatusResult,
  ScopeStore,
} from "../src/service";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;

export const WORKTREE = "env_nu8k8jjdu3";
export const CHECKOUT = "env_t3w24mmpux";
export const WORKTREE_THREAD = "thr_worktree";
export const CHECKOUT_THREAD = "thr_checkout";
export const NO_ENV_THREAD = "thr_noenv";

const targetKey = (target: DiffTarget) => (target.target === "uncommitted" ? "uncommitted" : `${target.target}:${target.mergeBaseBranch}`);

/** Serves the captured fixtures: env_nu8k8jjdu3 is a worktree on rework/solution-page, env_t3w24mmpux a checkout on main. */
export class FakeDiffSdk implements DiffSdk {
  threads = new Map<string, string | null>([
    [WORKTREE_THREAD, WORKTREE],
    [CHECKOUT_THREAD, CHECKOUT],
    [NO_ENV_THREAD, null],
  ]);
  statuses = new Map<string, EnvironmentStatusResult>([
    [WORKTREE, fixture("env_nu8k8jjdu3.status.json")],
    [CHECKOUT, fixture("env_t3w24mmpux.status.json")],
  ]);
  branchLists = new Map<string, EnvironmentDiffBranchesResult>([
    [WORKTREE, fixture("nu.branches-main.json")],
    [CHECKOUT, fixture("agent.branches.json")],
  ]);
  fileLists = new Map<string, EnvironmentDiffFilesResult | Error>([
    [`${WORKTREE} all:origin/main`, fixture("nu.all-origin-main.json")],
    [`${WORKTREE} branch_committed:origin/main`, fixture("nu.branch-origin-main.json")],
    [`${WORKTREE} all:main`, fixture("nu.all-main-truncated.json")],
    [`${WORKTREE} uncommitted`, fixture("nu.uncommitted.json")],
    [`${CHECKOUT} all:main`, fixture("agent.all.json")],
    [`${CHECKOUT} uncommitted`, fixture("agent.all.json")],
  ]);
  patchResult: EnvironmentDiffPatchResult | Error = fixture("nu.patch.json");
  calls: { method: string; args: unknown[] }[] = [];

  async environmentIdOf(threadId: string) {
    this.calls.push({ method: "environmentIdOf", args: [threadId] });
    if (!this.threads.has(threadId)) throw new Error(`Thread not found: ${threadId}`);
    return this.threads.get(threadId) ?? null;
  }
  async status(environmentId: string) {
    this.calls.push({ method: "status", args: [environmentId] });
    const status = this.statuses.get(environmentId);
    if (status === undefined) throw new Error(`no status for ${environmentId}`);
    return status;
  }
  async branches(environmentId: string, query?: string) {
    this.calls.push({ method: "branches", args: [environmentId, query] });
    const list = this.branchLists.get(environmentId);
    if (list === undefined) throw new Error(`no branches for ${environmentId}`);
    return list;
  }
  async files(environmentId: string, target: DiffTarget) {
    this.calls.push({ method: "files", args: [environmentId, target] });
    const result = this.fileLists.get(`${environmentId} ${targetKey(target)}`);
    if (result === undefined) throw new Error(`Unknown revision ${targetKey(target)}`);
    if (result instanceof Error) throw result;
    return result;
  }
  async patches(environmentId: string, target: DiffTarget, paths: string[]) {
    this.calls.push({ method: "patches", args: [environmentId, target, paths] });
    if (this.patchResult instanceof Error) throw this.patchResult;
    return this.patchResult;
  }

  callsTo(method: string) {
    return this.calls.filter((call) => call.method === method).map((call) => call.args);
  }
}

export class MemoryScopeStore implements ScopeStore {
  scopes = new Map<string, Scope>();
  async get(environmentId: string) {
    return this.scopes.get(environmentId) ?? null;
  }
  async set(environmentId: string, scope: Scope | null) {
    if (scope === null) this.scopes.delete(environmentId);
    else this.scopes.set(environmentId, scope);
  }
}

export const file = (path: string, additions: number, deletions: number, rest: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  previousPath: null,
  changeKind: "modified",
  additions,
  deletions,
  binary: false,
  untracked: false,
  tooLarge: false,
  ...rest,
});
