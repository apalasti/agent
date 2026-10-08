import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ResolvedConfig } from "../contract";
import { errorMessage, useWorktreesRpc } from "./data";

const DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, delay = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useProjectConfig(projectId: string | null) {
  const rpc = useWorktreesRpc();
  const [config, setConfig] = useState<ResolvedConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    rpc.call("getConfig", { projectId }).then(
      (result) => !cancelled && setConfig(result),
      (cause: unknown) => !cancelled && setError(errorMessage(cause)),
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId]);
  return { config, error, setConfig };
}

export type BranchCheck =
  | { state: "empty" }
  | { state: "checking" }
  | { state: "ok"; existingWorktreePath: string | null }
  | { state: "invalid"; message: string };

export function useBranchCheck(projectId: string | null, branch: string): BranchCheck {
  const rpc = useWorktreesRpc();
  const trimmed = branch.trim();
  const debounced = useDebounced(trimmed);
  const [result, setResult] = useState<{ branch: string; check: BranchCheck } | null>(null);

  useEffect(() => {
    if (projectId === null || debounced === "") return;
    let cancelled = false;
    rpc.call("validateBranch", { projectId, branch: debounced }).then(
      (response) => {
        if (cancelled) return;
        setResult({
          branch: debounced,
          check: response.ok
            ? { state: "ok", existingWorktreePath: response.existingWorktreePath }
            : { state: "invalid", message: response.message ?? "Invalid branch name" },
        });
      },
      (cause: unknown) => {
        if (!cancelled) setResult({ branch: debounced, check: { state: "invalid", message: errorMessage(cause) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, debounced]);

  if (trimmed === "") return { state: "empty" };
  if (result === null || result.branch !== trimmed) return { state: "checking" };
  return result.check;
}

export function useBranchSuggestions(projectId: string | null, query: string): string[] {
  const rpc = useWorktreesRpc();
  const debounced = useDebounced(query.trim());
  const [branches, setBranches] = useState<string[]>([]);
  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    rpc.call("branches", { projectId, query: debounced, limit: 50 }).then(
      (result) => !cancelled && setBranches(result.branches),
      () => !cancelled && setBranches([]),
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, debounced]);
  return branches;
}

export function BranchCheckMessage({ check }: { check: BranchCheck }) {
  if (check.state === "invalid") {
    return (
      <p role="alert" className="text-xs text-destructive">
        {check.message}
      </p>
    );
  }
  if (check.state === "ok" && check.existingWorktreePath !== null) {
    return (
      <p className="truncate text-xs text-muted-foreground" title={check.existingWorktreePath}>
        A worktree for this branch exists; the thread will start there.
      </p>
    );
  }
  return null;
}

export function TaskFields({
  projectId,
  branch,
  onBranchChange,
  from,
  onFromChange,
  defaultBase,
  check,
  autoFocus = false,
  compact = false,
}: {
  projectId: string | null;
  branch: string;
  onBranchChange: (value: string) => void;
  from: string;
  onFromChange: (value: string) => void;
  defaultBase: string | null;
  check: BranchCheck;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const branchId = useId();
  const fromId = useId();
  const listId = useId();
  const suggestions = useBranchSuggestions(projectId, from);
  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={branchId}>Branch</Label>
        <Input
          id={branchId}
          value={branch}
          autoFocus={autoFocus}
          spellCheck={false}
          placeholder="feat/short-name"
          aria-invalid={check.state === "invalid"}
          onChange={(event) => onBranchChange(event.target.value)}
          className="h-8 font-mono text-sm"
        />
        <BranchCheckMessage check={check} />
      </div>
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={fromId}>Base</Label>
        <Input
          id={fromId}
          value={from}
          spellCheck={false}
          list={listId}
          placeholder={defaultBase ?? "default branch"}
          onChange={(event) => onFromChange(event.target.value)}
          className="h-8 font-mono text-sm"
        />
        <datalist id={listId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
