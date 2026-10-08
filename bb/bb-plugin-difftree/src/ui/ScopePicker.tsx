import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { BranchesResult, rpcContract, Scope } from "../contract";
import { scopeLabel } from "../scope";
import { errorMessage } from "./useDiffTree";

export const BRANCH_QUERY_DEBOUNCE_MS = 200;

type Kind = Scope["kind"];
type BasedKind = Exclude<Kind, "uncommitted">;

const KIND_LABEL: Record<Kind, string> = {
  uncommitted: "Uncommitted",
  all: "All changes",
  committed: "Commits",
};

const KIND_DESCRIPTION: Record<Kind, string> = {
  uncommitted: "Working tree vs HEAD",
  all: "Working tree vs the base branch",
  committed: "HEAD vs the base branch",
};

export interface ScopePickerProps {
  threadId: string;
  scope: Scope;
  /** Null when the server did not say whether `scope` is remembered or the default. */
  scopeIsDefault: boolean | null;
  disabled?: boolean;
  onChange(scope: Scope | null): void;
}

export function ScopePicker({ threadId, scope, scopeIsDefault, disabled = false, onChange }: ScopePickerProps) {
  const lastBase = useRef<string | null>(null);
  if (scope.kind !== "uncommitted") lastBase.current = scope.base;
  const [pendingKind, setPendingKind] = useState<BasedKind | null>(null);
  const [baseOpen, setBaseOpen] = useState(false);

  const pickKind = (kind: Kind) => {
    if (kind === scope.kind) return;
    if (kind === "uncommitted") return onChange({ kind });
    const base = scope.kind === "uncommitted" ? lastBase.current : scope.base;
    if (base !== null) return onChange({ kind, base });
    setPendingKind(kind);
  };

  const baseKind: BasedKind | null = pendingKind ?? (scope.kind === "uncommitted" ? null : scope.kind);
  const base = scope.kind === "uncommitted" ? null : scope.base;

  return (
    <div className="flex min-w-0 items-center gap-0.5" title={scopeLabel(scope) + (scopeIsDefault ? " (default)" : "")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={disabled} aria-label={`Scope: ${KIND_LABEL[scope.kind]}`} className="h-7 shrink-0 gap-1 px-2">
            {KIND_LABEL[scope.kind]}
            <Icon name="ChevronDown" aria-hidden className="!size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-64"
          onCloseAutoFocus={(event) => {
            // Opening the base picker while the menu is still closing gets it dismissed as an outside interaction.
            if (pendingKind === null) return;
            event.preventDefault();
            setBaseOpen(true);
          }}
        >
          <DropdownMenuRadioGroup value={scope.kind} onValueChange={(value) => pickKind(value as Kind)}>
            {(["uncommitted", "all", "committed"] as const).map((kind) => (
              <DropdownMenuRadioItem key={kind} value={kind}>
                <span className="flex flex-col">
                  <span>{KIND_LABEL[kind]}</span>
                  <span className="text-xs text-muted-foreground">{KIND_DESCRIPTION[kind]}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={scopeIsDefault === true} onSelect={() => onChange(null)}>
            {scopeIsDefault === true ? "Using this environment's default" : "Reset to this environment's default"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {baseKind === null ? null : (
        <BasePicker
          threadId={threadId}
          base={base}
          open={baseOpen}
          disabled={disabled}
          onOpenChange={(open) => {
            setBaseOpen(open);
            if (!open) setPendingKind(null);
          }}
          onPick={(picked) => {
            setBaseOpen(false);
            setPendingKind(null);
            onChange({ kind: baseKind, base: picked });
          }}
        />
      )}
    </div>
  );
}

type BranchesState =
  | { status: "loading"; previous: BranchesResult | null }
  | { status: "done"; result: BranchesResult }
  | { status: "error"; message: string };

function useBranches(threadId: string, query: string, enabled: boolean): BranchesState {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<BranchesState>({ status: "loading", previous: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((current) => ({ status: "loading", previous: current.status === "done" ? current.result : null }));
    const timer = setTimeout(() => {
      const trimmed = query.trim();
      rpc.call("branches", trimmed === "" ? { threadId } : { threadId, query: trimmed }).then(
        (result) => {
          if (!cancelled) setState({ status: "done", result });
        },
        (cause: unknown) => {
          if (!cancelled) setState({ status: "error", message: errorMessage(cause) });
        },
      );
    }, BRANCH_QUERY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rpc, threadId, query, enabled]);
  return state;
}

function BasePicker({
  threadId,
  base,
  open,
  disabled,
  onOpenChange,
  onPick,
}: {
  threadId: string;
  base: string | null;
  open: boolean;
  disabled: boolean;
  onOpenChange(open: boolean): void;
  onPick(base: string): void;
}) {
  const [query, setQuery] = useState("");
  const state = useBranches(threadId, query, open);
  const shown = state.status === "done" ? state.result : state.status === "loading" ? state.previous : null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={base === null ? "Pick a base branch" : `Base branch: ${base}`}
          className="h-7 min-w-0 gap-1 px-2 font-normal"
        >
          <span className="shrink-0 text-muted-foreground">vs</span>
          <span className="min-w-0 truncate">{base ?? "pick a base…"}</span>
          <Icon name="ChevronDown" aria-hidden className="!size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" mobileTitle="Base branch">
        <Command shouldFilter={false} label="Base branch">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search branches…" aria-label="Search branches" />
          <CommandList aria-label="Branches">
            {state.status === "error" ? (
              <p role="alert" className="px-3 py-4 text-xs text-destructive">
                Couldn't list branches: {state.message}
              </p>
            ) : shown === null ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">Loading branches…</p>
            ) : (
              <>
                <CommandEmpty className="py-4 text-xs text-muted-foreground">No branch matches “{query}”.</CommandEmpty>
                <BranchGroup heading="Remote" branches={shown.remote} current={base} onPick={onPick} />
                <BranchGroup heading="Local" branches={shown.local} current={base} onPick={onPick} />
                {shown.truncated ? (
                  <p className="px-3 pb-2 pt-1 text-[11px] text-muted-foreground">More branches exist; type to narrow the list.</p>
                ) : null}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function BranchGroup({
  heading,
  branches,
  current,
  onPick,
}: {
  heading: string;
  branches: string[];
  current: string | null;
  onPick(branch: string): void;
}) {
  if (branches.length === 0) return null;
  return (
    <CommandGroup heading={heading}>
      {branches.map((branch) => (
        <CommandItem key={`${heading}:${branch}`} value={`${heading}:${branch}`} onSelect={() => onPick(branch)} className="text-[13px]">
          <Icon name="GitBranch" aria-hidden className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{branch}</span>
          <Icon name="Check" aria-hidden className={cn(branch === current ? "visible" : "invisible")} />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
