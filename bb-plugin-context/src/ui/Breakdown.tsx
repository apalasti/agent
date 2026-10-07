import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Category, Entry } from "../contract";
import { CATEGORY_STYLE, formatTokens, percent } from "./format";

type CategoryEntry = Category["entries"][number];

function Disclosure({ open }: { open: boolean }) {
  return (
    <Icon
      name="ChevronRight"
      aria-hidden
      className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
    />
  );
}

function Detail({ detail }: { detail: string | null }) {
  if (detail === null || detail === "") return null;
  return (
    <span title={detail} className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
      {detail}
    </span>
  );
}

function TurnRef({ entry, onSelectTurn }: { entry: Entry; onSelectTurn: (turnIndex: number) => void }) {
  if (entry.turnIndex === null) return null;
  const turnIndex = entry.turnIndex;
  return (
    <button
      type="button"
      onClick={() => onSelectTurn(turnIndex)}
      aria-label={`Show turn ${turnIndex}`}
      className="shrink-0 rounded px-1 text-[11px] tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      #{turnIndex}
    </button>
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
      className="flex min-w-0 items-center gap-2 py-1 text-xs"
      style={{ paddingLeft: `${2.25 + depth}rem` }}
      title={fullName(entry)}
      data-entry
    >
      {label === null ? null : <span className="min-w-0 max-w-[50%] shrink-0 truncate text-foreground">{label}</span>}
      {label === null && !entry.detail ? (
        <span className="shrink-0 text-muted-foreground">{entry.label}</span>
      ) : (
        <Detail detail={entry.detail} />
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1 pr-4">
        <TurnRef entry={entry} onSelectTurn={onSelectTurn} />
        <span className="w-12 text-right tabular-nums text-muted-foreground">{formatTokens(entry.tokens)}</span>
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
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 py-1 pl-6 pr-4 text-left text-xs hover:bg-muted/50"
      >
        <Disclosure open={open} />
        <span className="min-w-0 max-w-[50%] shrink-0 truncate text-foreground">{entry.label}</span>
        <Detail detail={entry.detail} />
        <span className="ml-auto hidden shrink-0 text-[11px] text-muted-foreground @[20rem]:inline">
          {entry.children.length} largest
        </span>
        <span className="ml-auto w-12 shrink-0 @[20rem]:ml-0 text-right tabular-nums text-muted-foreground">{formatTokens(entry.tokens)}</span>
      </button>
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
      {expandable ? <Disclosure open={open} /> : <span className="size-3.5 shrink-0" />}
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          CATEGORY_STYLE[category.id].dot,
          category.id === "free" && "border border-border",
        )}
      />
      <span
        className={cn("min-w-0 flex-1 truncate", muted ? "text-muted-foreground" : "text-foreground")}
        title={[category.label, share.window, hint?.full].filter(Boolean).join(" · ")}
      >
        {category.label}
        {suffix === null ? null : <span className="text-xs tabular-nums text-muted-foreground"> · {suffix}</span>}
      </span>
      <span className="w-14 shrink-0 text-right tabular-nums text-foreground">{formatTokens(category.tokens)}</span>
      <span className="hidden w-10 shrink-0 text-right tabular-nums text-muted-foreground @[17rem]:inline">{share.used}</span>
    </>
  );
  const rowClass = "flex w-full min-w-0 items-center gap-2 px-4 py-1.5 text-left text-sm";
  return (
    <li>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={cn(rowClass, "hover:bg-muted/50")}
        >
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
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
        <div className="mt-2 opacity-75">
          <p className="px-4 pb-0.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Available on demand (not counted)
          </p>
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
