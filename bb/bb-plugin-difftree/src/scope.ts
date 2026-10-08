import type { Scope } from "./contract";

export interface BranchStatus {
  currentBranch: string | null;
  defaultBranch: string | null;
  detached: boolean;
}

export type DiffTarget = { target: "uncommitted" } | { target: "all" | "branch_committed"; mergeBaseBranch: string };

export function defaultScope(status: BranchStatus, remoteBranches: readonly string[]): Scope {
  const { currentBranch, defaultBranch, detached } = status;
  if (detached || currentBranch === null || defaultBranch === null || currentBranch === defaultBranch) {
    return { kind: "uncommitted" };
  }
  const remote = `origin/${defaultBranch}`;
  return { kind: "all", base: remoteBranches.includes(remote) ? remote : defaultBranch };
}

export function toTarget(scope: Scope): DiffTarget {
  switch (scope.kind) {
    case "uncommitted":
      return { target: "uncommitted" };
    case "all":
      return { target: "all", mergeBaseBranch: scope.base };
    case "committed":
      return { target: "branch_committed", mergeBaseBranch: scope.base };
  }
}

export function scopeLabel(scope: Scope): string {
  switch (scope.kind) {
    case "uncommitted":
      return "Uncommitted";
    case "all":
      return `All changes vs ${scope.base}`;
    case "committed":
      return `Commits vs ${scope.base}`;
  }
}

export function baseOf(scope: Scope): string | null {
  return scope.kind === "uncommitted" ? null : scope.base;
}
