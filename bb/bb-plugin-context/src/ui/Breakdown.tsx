import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Category, Entry } from "../contract";
import { ActionRow, Chevron, Swatch } from "../kit";
import { CATEGORY_FILL, formatTokens, percent } from "./format";

type CategoryEntry = Category["entries"][number];

/** Every row shares these tracks so the token and share columns line up across lists. */
const GRID = "grid h-7 min-w-0 grid-cols-[0.75rem_minmax(0,1fr)_4rem_3rem] items-center gap-x-2 px-3 text-sm";

function Num({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return <span className={cn("text-right text-xs tabular-nums", strong ? "text-foreground" : "text-muted-foreground")}>{children}</span>;
}

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
      className="ml-auto h-5 shrink-0 px-1 text-xs font-normal tabular-nums text-subtle-foreground"
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
    <div className={GRID} title={fullName(entry)} data-entry>
      <span className={cn("col-start-2 flex min-w-0 items-center gap-2", depth > 0 && "pl-5")}>
        {label === null ? null : <span className="min-w-0 max-w-[50%] shrink-0 truncate text-foreground">{label}</span>}
        {label === null && !entry.detail ? (
          <span className="shrink-0 text-muted-foreground">{entry.label}</span>
        ) : (
          <Detail detail={entry.detail} />
        )}
        <TurnRef entry={entry} onSelectTurn={onSelectTurn} />
      </span>
      <Num>{formatTokens(entry.tokens)}</Num>
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
      <ActionRow aria-expanded={open} onClick={() => setOpen((value) => !value)} className={GRID}>
        <span className="col-start-2 flex min-w-0 items-center gap-2">
          <Chevron open={open} />
          <span className="min-w-0 max-w-[50%] shrink-0 truncate text-muted-foreground">{entry.label}</span>
          <Detail detail={entry.detail} />
        </span>
        <Num>{formatTokens(entry.tokens)}</Num>
        <Num>{entry.children.length}</Num>
      </ActionRow>
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

/** Used rows are shares of the used context; free and reserved space are shares of the window; deferred rows have none. */
export function shareOf(category: Category, used: number, contextWindow: number | null): string | null {
  if (category.kind === "used") return percent(category.tokens, used);
  if (category.kind === "deferred") return null;
  return percent(category.tokens, contextWindow);
}

const CATEGORY_HINT: Partial<Record<Category["id"], { short: string; full: string }>> = {
  unattributed: { short: "not itemized", full: "Counted by the provider but not traceable to any item in the session file" },
  reserved: { short: "kept free", full: "Reserved so automatic compaction has room to run" },
};

function categoryTitle(category: Category, share: string | null): string {
  const scope =
    category.kind === "deferred"
      ? "Not counted: loaded on demand"
      : share === null || category.kind === "used"
        ? null
        : `${share} of the window`;
  return [category.label, scope, CATEGORY_HINT[category.id]?.full].filter(Boolean).join("\n");
}

function LegendRow({ category, used, contextWindow }: { category: Category; used: number; contextWindow: number | null }) {
  const share = shareOf(category, used, contextWindow);
  const hint = CATEGORY_HINT[category.id];
  return (
    <li className={GRID} title={categoryTitle(category, share)}>
      <Swatch className={cn(CATEGORY_FILL[category.id], category.id === "free" && "border border-border")} />
      <span className="flex min-w-0 items-baseline gap-3">
        <span className="min-w-0 truncate text-foreground">{category.label}</span>
        {hint === undefined ? null : <span className="shrink-0 text-xs text-subtle-foreground">{hint.short}</span>}
      </span>
      <Num>{formatTokens(category.tokens)}</Num>
      <Num strong>{share ?? "—"}</Num>
    </li>
  );
}

function CategoryGroup({ category, onSelectTurn }: { category: Category; onSelectTurn: (turnIndex: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <ActionRow aria-expanded={open} onClick={() => setOpen((value) => !value)} className={GRID}>
        <Chevron open={open} />
        <span className="min-w-0 truncate text-muted-foreground">{category.label}</span>
        <Num>{formatTokens(category.tokens)}</Num>
        <Num>{category.entries.length}</Num>
      </ActionRow>
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
  const itemized = [...counted, ...deferred].filter((category) => category.entries.length > 0);
  return (
    <div>
      <ul aria-label="Context categories">
        {counted.map((category) => (
          <LegendRow key={category.id} category={category} used={used} contextWindow={contextWindow} />
        ))}
      </ul>
      {deferred.length === 0 ? null : (
        <ul aria-label="Available on demand">
          {deferred.map((category) => (
            <LegendRow key={category.id} category={category} used={used} contextWindow={null} />
          ))}
        </ul>
      )}
      {itemized.length === 0 ? null : (
        <ul aria-label="Category details" className="mt-1">
          {itemized.map((category) => (
            <CategoryGroup key={category.id} category={category} onSelectTurn={onSelectTurn} />
          ))}
        </ul>
      )}
    </div>
  );
}
