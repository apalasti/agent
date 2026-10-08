import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { TaskRow } from "./model";
import { CLAIMED_TEXT, STATE_DOT, typeText } from "./tone";
import type { Modifiers } from "./useLaunch";

export function TicketRow({
  row,
  busy,
  onOpenThread,
  onRun,
}: {
  row: TaskRow;
  busy: string | null;
  onOpenThread: (threadId: string) => void;
  onRun: (row: TaskRow, event: Modifiers) => void;
}) {
  const blockedHint = row.blockers.map((blocker) => `${blocker.number} ${blocker.title}`).join("\n");
  const hint = row.claimed ? `Claimed ${row.claimed}; running it takes the claim over` : row.state === "blocked" ? blockedHint : undefined;

  return (
    <li
      className={cn("flex min-h-8 items-center gap-2 rounded-md px-2 py-0.5 hover:bg-state-hover", row.state === "done" && "opacity-70")}
      title={hint}
    >
      <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT[row.state])} aria-hidden="true" />
      <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{row.number}</span>
      {row.type !== null ? <span className={cn("shrink-0 text-[11px]", typeText(row.type))}>{row.type}</span> : null}
      <span className={cn("min-w-0 flex-1 truncate", row.state === "blocked" && "text-muted-foreground")} title={hint === undefined ? row.title : undefined}>
        {row.title}
      </span>
      {row.claimed ? <span className={cn("shrink-0 text-[11px]", CLAIMED_TEXT)}>claimed</span> : null}
      <Action row={row} busy={busy} onOpenThread={onOpenThread} onRun={onRun} />
    </li>
  );
}

function Action({
  row,
  busy,
  onOpenThread,
  onRun,
}: {
  row: TaskRow;
  busy: string | null;
  onOpenThread: (threadId: string) => void;
  onRun: (row: TaskRow, event: Modifiers) => void;
}) {
  if (row.state === "done") return null;
  if (row.state === "blocked") {
    return (
      <span className="flex shrink-0 gap-1 font-mono text-[11px] text-subtle-foreground">
        {row.blockers.map((blocker) => (
          <span key={blocker.number} title={blocker.title} className="rounded border border-border px-1">
            {blocker.number}
          </span>
        ))}
      </span>
    );
  }
  if (row.threadId === null) {
    return (
      <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={(event) => onRun(row, event)}>
        {busy === row.ref ? "Starting…" : "Run"}
      </Button>
    );
  }
  const threadId = row.threadId;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <Button size="sm" variant="outline" className="h-7" onClick={() => onOpenThread(threadId)}>
        Open
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-7" aria-label={`More for ${row.ref}`} disabled={busy !== null}>
            <Icon name="MoreHorizontal" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onRun(row, { metaKey: false, ctrlKey: false })}>
            <Icon name="RotateCcw" aria-hidden="true" />
            {busy === row.ref ? "Starting…" : "Run again"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
