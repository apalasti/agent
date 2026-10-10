import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Mono, Row, RowButton, RowTitle, StatusDot, Tag } from "../../kit";
import type { TaskRow } from "./model";
import { STATE_STATUS } from "./tone";
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
    <li>
      <Row leading={<StatusDot status={STATE_STATUS[row.state]} />} muted={row.state === "done"} title={hint}>
        <Mono className="w-5 shrink-0 tabular-nums text-muted-foreground">{row.number}</Mono>
        {row.type !== null ? <Tag>{row.type}</Tag> : null}
        <RowTitle className={cn(row.state === "blocked" && "text-muted-foreground")} title={hint === undefined ? row.title : undefined}>
          {row.title}
        </RowTitle>
        {row.claimed ? <Tag>claimed</Tag> : null}
        <Action row={row} busy={busy} onOpenThread={onOpenThread} onRun={onRun} />
      </Row>
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
      <span className="flex shrink-0 gap-1">
        {row.blockers.map((blocker) => (
          <Tag key={blocker.number} title={blocker.title} className="font-mono">
            {blocker.number}
          </Tag>
        ))}
      </span>
    );
  }
  if (row.threadId === null) {
    return (
      <RowButton disabled={busy !== null} onClick={(event) => onRun(row, event)}>
        {busy === row.ref ? "Starting…" : "Run"}
      </RowButton>
    );
  }
  const threadId = row.threadId;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <RowButton onClick={() => onOpenThread(threadId)}>Open</RowButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-6.5 text-muted-foreground [&_[data-icon-root]]:size-3.5"
            aria-label={`More for ${row.ref}`}
            disabled={busy !== null}
          >
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
