import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type {
  BranchesInput,
  BranchesResult,
  ChangedFile,
  PatchInput,
  PatchResult,
  Scope,
  SetScopeInput,
  TreeInput,
  TreeResult,
} from "./contract";
import { baseOf, defaultScope, toTarget, type DiffTarget } from "./scope";

type Environments = BbPluginApi["sdk"]["environments"];
type Result<K extends keyof Environments> = Environments[K] extends (...args: never[]) => Promise<infer R> ? R : never;
export type EnvironmentStatusResult = Result<"status">;
export type EnvironmentDiffBranchesResult = Result<"diffBranches">;
export type EnvironmentDiffFilesResult = Result<"diffFiles">;
export type EnvironmentDiffPatchResult = Result<"diffPatch">;

export interface DiffSdk {
  environmentIdOf(threadId: string): Promise<string | null>;
  status(environmentId: string): Promise<EnvironmentStatusResult>;
  branches(environmentId: string, query?: string): Promise<EnvironmentDiffBranchesResult>;
  files(environmentId: string, target: DiffTarget): Promise<EnvironmentDiffFilesResult>;
  patches(environmentId: string, target: DiffTarget, paths: string[]): Promise<EnvironmentDiffPatchResult>;
}

export interface ScopeStore {
  get(environmentId: string): Promise<Scope | null>;
  set(environmentId: string, scope: Scope | null): Promise<void>;
}

export interface DiffService {
  tree(input: TreeInput): Promise<TreeResult>;
  patch(input: PatchInput): Promise<PatchResult>;
  branches(input: BranchesInput): Promise<BranchesResult>;
  setScope(input: SetScopeInput): Promise<TreeResult>;
}

type ApiFile = Extract<EnvironmentDiffFilesResult, { outcome: "available" }>["files"][number];
type Failure = Exclude<EnvironmentDiffFilesResult, { outcome: "available" }>;
type Unresolved = Exclude<TreeResult, { outcome: "available" }>;

export const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function toChangedFile(file: ApiFile): ChangedFile {
  return {
    path: file.path,
    previousPath: file.previousPath,
    changeKind: file.changeKind,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
    untracked: file.origin === "untracked",
    tooLarge: file.loadMode === "too_large",
  };
}

const failureMessage = (failure: Failure) => (failure.outcome === "not_applicable" ? failure.message : failure.failure.message);

function namingBase(scope: Scope, message: string): string {
  const base = baseOf(scope);
  if (base === null || message.includes(base)) return message;
  return `Could not diff against ${base}: ${message}`;
}

export function createDiffService(sdk: DiffSdk, store: ScopeStore): DiffService {
  type Resolved = { ok: true; environmentId: string } | { ok: false; result: Unresolved };

  async function resolveEnvironment(threadId: string, scope: Scope | null): Promise<Resolved> {
    try {
      const environmentId = await sdk.environmentIdOf(threadId);
      if (environmentId !== null) return { ok: true, environmentId };
      return {
        ok: false,
        result: { outcome: "no_environment", environmentId: null, scope, message: `Thread ${threadId} has no environment.` },
      };
    } catch (cause) {
      return {
        ok: false,
        result: { outcome: "unavailable", environmentId: null, scope, message: `Thread ${threadId}: ${errorMessage(cause)}` },
      };
    }
  }

  const remembered = (environmentId: string) => store.get(environmentId).catch(() => null);

  async function chooseDefault(environmentId: string, status: EnvironmentStatusResult): Promise<Scope> {
    if (status.outcome !== "available") return { kind: "uncommitted" };
    const { branch, checkout } = status.workspace;
    const detached = checkout.kind !== "branch";
    const needsRemote = !detached && branch.currentBranch !== null && branch.currentBranch !== branch.defaultBranch;
    const remote = needsRemote
      ? await sdk.branches(environmentId, branch.defaultBranch).then((r) => r.remoteBranches, () => [])
      : [];
    return defaultScope({ currentBranch: branch.currentBranch, defaultBranch: branch.defaultBranch, detached }, remote);
  }

  async function tree(input: TreeInput): Promise<TreeResult> {
    const resolved = await resolveEnvironment(input.threadId, input.scope);
    if (!resolved.ok) return resolved.result;
    const { environmentId } = resolved;

    const [stored, status] = await Promise.all([
      input.scope === null ? remembered(environmentId) : Promise.resolve(null),
      sdk.status(environmentId).catch((cause: unknown) => cause instanceof Error ? cause : new Error(String(cause))),
    ]);

    let scope = input.scope ?? stored;
    const scopeIsDefault = scope === null;
    if (scope === null) {
      if (status instanceof Error) {
        return { outcome: "unavailable", environmentId, scope: null, message: status.message };
      }
      if (status.outcome !== "available") {
        return { outcome: status.outcome, environmentId, scope: null, message: failureMessage(status) };
      }
      scope = await chooseDefault(environmentId, status);
    }

    let files: EnvironmentDiffFilesResult;
    try {
      files = await sdk.files(environmentId, toTarget(scope));
    } catch (cause) {
      return { outcome: "unavailable", environmentId, scope, message: namingBase(scope, errorMessage(cause)) };
    }
    if (files.outcome === "not_applicable") {
      return { outcome: "not_applicable", environmentId, scope, message: files.message };
    }
    if (files.outcome === "unavailable") {
      return { outcome: "unavailable", environmentId, scope, message: namingBase(scope, files.failure.message) };
    }

    const base = baseOf(scope);
    // bb answers an unknown base with an empty "available" diff; only the missing merge base gives it away.
    if (base !== null && files.mergeBaseRef === null) {
      return { outcome: "unavailable", environmentId, scope, message: `No merge base with ${base}. Does the branch exist?` };
    }

    const changed = files.files.map(toChangedFile);
    const currentBranch = status instanceof Error || status.outcome !== "available" ? null : status.workspace.branch.currentBranch;
    return {
      outcome: "available",
      environmentId,
      scope,
      scopeIsDefault,
      currentBranch,
      mergeBaseRef: files.mergeBaseRef,
      files: changed,
      truncated: files.truncated,
      totals: {
        files: changed.length,
        additions: changed.reduce((sum, file) => sum + file.additions, 0),
        deletions: changed.reduce((sum, file) => sum + file.deletions, 0),
      },
    };
  }

  async function patch(input: PatchInput): Promise<PatchResult> {
    const { path } = input;
    const resolved = await resolveEnvironment(input.threadId, input.scope);
    if (!resolved.ok) return { outcome: "unavailable", path, message: resolved.result.message };
    try {
      const result = await sdk.patches(resolved.environmentId, toTarget(input.scope), [path]);
      if (result.outcome !== "available") return { outcome: "unavailable", path, message: failureMessage(result) };
      const found = result.patches.find((entry) => entry.path === path);
      if (found === undefined) return { outcome: "unavailable", path, message: `No patch for ${path}.` };
      return { outcome: "available", path, patch: found.patch, truncated: found.truncated };
    } catch (cause) {
      return { outcome: "unavailable", path, message: namingBase(input.scope, errorMessage(cause)) };
    }
  }

  async function branches(input: BranchesInput): Promise<BranchesResult> {
    const empty = { local: [], remote: [], truncated: false };
    const resolved = await resolveEnvironment(input.threadId, null);
    if (!resolved.ok) return { ...empty, message: resolved.result.message };
    try {
      const result = await sdk.branches(resolved.environmentId, input.query);
      return {
        local: result.branches,
        remote: result.remoteBranches,
        truncated: result.branchesTruncated || result.remoteBranchesTruncated,
      };
    } catch (cause) {
      return { ...empty, message: errorMessage(cause) };
    }
  }

  async function setScope(input: SetScopeInput): Promise<TreeResult> {
    const resolved = await resolveEnvironment(input.threadId, input.scope);
    if (!resolved.ok) return resolved.result;
    try {
      await store.set(resolved.environmentId, input.scope);
    } catch (cause) {
      return { outcome: "unavailable", environmentId: resolved.environmentId, scope: input.scope, message: errorMessage(cause) };
    }
    return tree({ threadId: input.threadId, scope: null });
  }

  return { tree, patch, branches, setScope };
}
