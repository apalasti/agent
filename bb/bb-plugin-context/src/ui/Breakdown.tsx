import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Category, Entry } from "../contract";
import { Chevron, Dot, Leading, SectionLabel } from "../kit";
import { CATEGORY_FILL, formatTokens, percent } from "./format";
import { RowAction } from "./RowAction";

type CategoryEntry = Category["entries"][number];

function Detail({ detail }: { detail: string | null }) {
  if (detail === null || detail === "") return null;
  return (
    <span title={detail} className="min-w-0 truncate font-mono text-xs text-subtle-foreground">
      {detail}
    </span>
  );
}

function TurnRef({ entry, onSelectTurn }: { entry: Entry; onSelectTurn: (turnIndex: number) => void }) {
  if (entry.turnIndex === null) return null;
  const turnIndex = entry.turnIndex;
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onSelectTurn(turnIndex)}
      aria-label={`Show turn ${turnIndex}`}
      className="h-5 shrink-0 px-1 text-xs font-normal tabular-nums text-subtle-foreground"
    >
      #{turnIndex}
    </Button>
  );
}

function fullName(entry: Entry): string {
  return entry.detail ? `${entry.label} ${entry.detail}` : entry.label;
}

function EntryLine({
  entry,
  label,
  depth,
  onSelectTurn,
}: {
  entry: Entry;
  label: string | null;
  depth: number;
  onSelectTurn: (turnIndex: number) => void;
}) {
  return (
    <div
      className="flex h-7 min-w-0 items-center gap-2 pr-3 text-sm hover:bg-state-hover"
      style={{ paddingLeft: `${2 + depth}rem` }}
      title={fullName(entry)}
      data-entry
    >
      {label === null ? null : <span className="min-w-0 max-w-[50%] shrink-0 truncate text-foreground">{label}</span>}
      {label === null && !entry.detail ? (
        <span className="shrink-0 text-muted-foreground">{entry.label}</span>
      ) : (
        <Detail detail={entry.detail} />
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <TurnRef entry={entry} onSelectTurn={onSelectTurn} />
        <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatTokens(entry.tokens)}</span>
      </span>
    </div>
  );
}

function EntryRow({ entry, onSelectTurn }: { entry: CategoryEntry; onSelectTurn: (turnIndex: number) => void }) {
  const [open, setOpen] = useState(false);
  if (entry.children.length === 0) return <EntryLine entry={entry} label={entry.label} depth={0} onSelectTurn={onSelectTurn} />;
  if (entry.children.length === 1) {
    const only = entry.children[0]!;
    return <EntryLine entry={{ ...only, tokens: entry.tokens }} label={entry.label} depth={0} onSelectTurn={onSelectTurn} />;
  }
  return (
    <div>
      <RowAction aria-expanded={open} onClick={() => setOpen((value) => !value)} className="pl-5">
        <Chevron open={open} />
        <span className="min-w-0 max-w-[50%] shrink-0 truncate">{entry.label}</span>
        <Detail detail={entry.detail} />
        <span className="ml-auto hidden shrink-0 text-xs text-subtle-foreground @[20rem]:inline">
          {entry.children.length} largest
        </span>
        <span className="ml-auto w-12 shrink-0 @[20rem]:ml-0 text-right text-xs tabular-nums text-muted-foreground">{formatTokens(entry.tokens)}</span>
      </RowAction>
      {open ? (
        <div role="group" aria-label={`${entry.label} items`}>
          {entry.children.map((child) => (
            <EntryLine key={child.id} entry={child} label={null} depth={1} onSelectTurn={onSelectTurn} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Used rows are shares of the used context; free and reserved space are shares of the window, said so in the label. */
export function shareOf(category: Category, used: number, contextWindow: number | null): { used: string; window: string | null } {
  if (category.kind === "used") return { used: percent(category.tokens, used) ?? "", window: null };
  const share = category.kind === "deferred" ? null : percent(category.tokens, contextWindow);
  return { used: "", window: share === null ? null : `${share} of window` };
}

const CATEGORY_HINT: Partial<Record<Category["id"], { short: string; full: string }>> = {
  unattributed: { short: "not itemized", full: "Counted by the provider but not traceable to any item in the session file" },
  reserved: { short: "kept free", full: "Reserved so automatic compaction has room to run" },
};

function CategoryRow({
  category,
  used,
  contextWindow,
  onSelectTurn,
}: {
  category: Category;
  used: number;
  contextWindow: number | null;
  onSelectTurn: (turnIndex: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const expandable = category.entries.length > 0;
  const muted = category.kind !== "used";
  const share = shareOf(category, used, contextWindow);
  const hint = CATEGORY_HINT[category.id];
  const suffix = share.window ?? hint?.short ?? null;
  const content = (
    <>
      <Leading>{expandable ? <Chevron open={open} /> : null}</Leading>
      <Dot className={cn(CATEGORY_FILL[category.id], category.id === "free" && "border border-border")} />
      <span
        className={cn("min-w-0 flex-1 truncate", muted ? "text-muted-foreground" : "text-foreground")}
        title={[category.label, share.window, hint?.full].filter(Boolean).join(" · ")}
      >
        {category.label}
        {suffix === null ? null : <span className="text-xs tabular-nums text-subtle-foreground"> · {suffix}</span>}
      </span>
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatTokens(category.tokens)}</span>
      <span className="hidden w-10 shrink-0 text-right text-xs tabular-nums text-subtle-foreground @[17rem]:inline">{share.used}</span>
    </>
  );
  return (
    <li>
      {expandable ? (
        <RowAction aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {content}
        </RowAction>
      ) : (
        <div className="flex h-7 min-w-0 items-center gap-2 px-3 text-sm hover:bg-state-hover">{content}</div>
      )}
      {open ? (
        <div role="group" aria-label={`${category.label} entries`} className="pb-1">
          {category.entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onSelectTurn={onSelectTurn} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function Breakdown({
  categories,
  used,
  contextWindow,
  onSelectTurn,
}: {
  categories: readonly Category[];
  used: number;
  contextWindow: number | null;
  onSelectTurn: (turnIndex: number) => void;
}) {
  const counted = categories.filter((category) => category.kind !== "deferred" && category.tokens > 0);
  const deferred = categories.filter((category) => category.kind === "deferred" && category.tokens > 0);
  return (
    <div>
      <ul aria-label="Context categories">
        {counted.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            used={used}
            contextWindow={contextWindow}
            onSelectTurn={onSelectTurn}
          />
        ))}
      </ul>
      {deferred.length === 0 ? null : (
        <div className="mt-1 border-t border-border-hairline">
          <SectionLabel>Available on demand (not counted)</SectionLabel>
          <ul aria-label="Available on demand">
            {deferred.map((category) => (
              <CategoryRow key={category.id} category={category} used={used} contextWindow={null} onSelectTurn={onSelectTurn} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
