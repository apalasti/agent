import { useRef, useState, type ReactNode } from "react";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TreeResult } from "../contract";
import { scopeLabel } from "../scope";
import { filterFiles } from "../tree";
import { ScopePicker } from "./ScopePicker";
import { Stats } from "./Stats";
import { TreeView, type TreeController } from "./TreeView";
import { useDiffTree } from "./useDiffTree";
import { useWrapLines } from "./useWrapLines";

type Available = Extract<TreeResult, { outcome: "available" }>;
type NotAvailable = Exclude<TreeResult, Available>;

const OUTCOME_TITLE: Record<NotAvailable["outcome"], string> = {
  no_environment: "No environment",
  not_applicable: "Not a git repository",
  unavailable: "Changes unavailable",
};

function StatusBox({ children, role = "status" }: { children: ReactNode; role?: "status" | "alert" }) {
  return (
    <div className="p-3">
      <div role={role} className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  className,
  pressed,
}: {
  icon: string;
  label: string;
  onClick(): void;
  className?: string;
  pressed?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn("size-7 shrink-0 text-muted-foreground", pressed && "bg-accent text-foreground", className)}
    >
      <Icon name={icon} aria-hidden className="!size-3.5" />
    </Button>
  );
}

function Summary({ result, refreshing }: { result: Available; refreshing: boolean }) {
  const { totals, mergeBaseRef } = result;
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 pb-1.5 text-xs" data-summary>
      <span className="shrink-0 text-foreground">
        {totals.files} {totals.files === 1 ? "file" : "files"}
      </span>
      <Stats additions={totals.additions} deletions={totals.deletions} />
      {mergeBaseRef === null ? null : (
        <span className="min-w-0 truncate text-muted-foreground" title={`Merge base ${mergeBaseRef}`}>
          base {mergeBaseRef.slice(0, 7)}
        </span>
      )}
      {refreshing ? (
        <span className="ml-auto shrink-0 text-muted-foreground" role="status">
          updating…
        </span>
      ) : null}
    </div>
  );
}

function TruncationBanner({ count }: { count: number }) {
  return (
    <p role="status" className="mx-3 mb-1.5 flex gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning-text">
      <Icon name="AlertTriangle" aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>bb lists at most {count} changed files, so some are missing here, and the totals cover only these {count}.</span>
    </p>
  );
}

function FilterBar({
  query,
  setQuery,
  matches,
  controller,
}: {
  query: string;
  setQuery(query: string): void;
  matches: number | null;
  controller: { current: TreeController | null };
}) {
  return (
    <div className="flex items-center gap-1 px-2 pb-1.5">
      <div className="relative min-w-0 flex-1">
        <Icon name="Search" aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query !== "") {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              controller.current?.focusFirstRow();
            }
          }}
          placeholder="Filter files"
          aria-label="Filter files"
          className="h-7 pl-7 pr-14 text-[13px] md:text-[13px]"
        />
        {query === "" ? null : (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground">
            {matches}
          </span>
        )}
      </div>
      <IconButton icon="ChevronsDown" label="Expand all" onClick={() => controller.current?.expandAll()} />
      <IconButton icon="ChevronsUp" label="Collapse all" onClick={() => controller.current?.collapseAll()} />
    </div>
  );
}

function AvailableView({
  threadId,
  result,
  refreshing,
  wrap,
}: {
  threadId: string;
  result: Available;
  refreshing: boolean;
  wrap: boolean;
}) {
  const [query, setQuery] = useState("");
  const controller = useRef<TreeController | null>(null);
  if (result.files.length === 0) {
    return (
      <>
        <Summary result={result} refreshing={refreshing} />
        <StatusBox>No changes · {scopeLabel(result.scope)}</StatusBox>
      </>
    );
  }
  const matches = query.trim() === "" ? null : filterFiles(result.files, query).length;
  return (
    <>
      <Summary result={result} refreshing={refreshing} />
      {result.truncated ? <TruncationBanner count={result.files.length} /> : null}
      <FilterBar query={query} setQuery={setQuery} matches={matches} controller={controller} />
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
        <TreeView
          key={`${result.environmentId}:${JSON.stringify(result.scope)}`}
          threadId={threadId}
          environmentId={result.environmentId}
          scope={result.scope}
          files={result.files}
          query={query}
          wrap={wrap}
          controllerRef={controller}
        />
      </div>
    </>
  );
}

export function DiffTreePanel({ threadId }: PluginThreadPanelProps) {
  const { result, error, refreshing, refetch, setScope } = useDiffTree(threadId);
  const [wrap, toggleWrap] = useWrapLines();

  let body: ReactNode;
  if (result === null && error !== null) {
    body = (
      <StatusBox role="alert">
        <p className="text-destructive">Couldn't load the changes: {error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={refetch}>
          Retry
        </Button>
      </StatusBox>
    );
  } else if (result === null) {
    body = <StatusBox>Loading changes…</StatusBox>;
  } else if (result.outcome === "available") {
    body = <AvailableView threadId={threadId} result={result} refreshing={refreshing} wrap={wrap} />;
  } else {
    body = (
      <StatusBox>
        <p className="font-medium text-foreground">{OUTCOME_TITLE[result.outcome]}</p>
        <p className="mt-1">{result.message}</p>
      </StatusBox>
    );
  }

  const scope = result?.scope ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-w-0 items-center gap-1 px-1.5 py-1.5">
        {scope === null ? (
          <span className="px-1.5 text-[13px] text-muted-foreground">Diff tree</span>
        ) : (
          <ScopePicker
            threadId={threadId}
            scope={scope}
            scopeIsDefault={result?.outcome === "available" ? result.scopeIsDefault : null}
            onChange={setScope}
          />
        )}
        <IconButton icon="TextWrap" label="Wrap long lines" pressed={wrap} onClick={toggleWrap} className="ml-auto" />
        <IconButton
          icon={refreshing ? "Loading" : "RotateCcw"}
          label="Refresh"
          onClick={refetch}
          className={cn(refreshing && "[&_[data-icon-root]]:animate-spin")}
        />
      </div>
      {error !== null && result !== null ? (
        <p role="alert" className="flex items-center gap-2 px-3 pb-1.5 text-xs text-destructive">
          <span className="min-w-0 truncate" title={error}>
            Couldn't refresh: {error}
          </span>
          <button type="button" className="shrink-0 underline" onClick={refetch}>
            Retry
          </button>
        </p>
      ) : null}
      {body}
    </div>
  );
}
