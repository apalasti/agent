import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CourseChange, Turn } from "../contract";
import { CourseChangeRow } from "./CourseChangeRow";
import { formatTokens } from "./format";
import { FORK_ICON } from "./icon";

export type TurnFlash = { turnIndex: number; nonce: number };

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Why a turn's actions are unavailable, or null when they are available. */
export function actionBlocker(turn: Turn, busy: boolean): string | null {
  if (busy || turn.running) return "Wait for the current turn to finish";
  if (!turn.editable) return "This message can't be edited (it is not in the active timeline)";
  return null;
}

function added(turn: Turn): string | null {
  if (turn.tokensAfter === null || turn.tokensBefore === null) return null;
  const delta = turn.tokensAfter - turn.tokensBefore;
  return `${turn.measured ? "" : "≈"}${delta >= 0 ? "+" : ""}${formatTokens(delta)}`;
}

function MiniBar({ tokens, contextWindow }: { tokens: number | null; contextWindow: number | null }) {
  const width = tokens === null || contextWindow === null || contextWindow <= 0 ? 0 : Math.min(100, (tokens / contextWindow) * 100);
  return (
    <span aria-hidden="true" className="relative h-1 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
      <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/50" style={{ width: `${width}%` }} />
    </span>
  );
}

function rewindSummary(turn: Turn, lastIndex: number, current: number | null): string {
  const discards = turn.index === lastIndex ? `discards turn ${turn.index}` : `discards turns ${turn.index}–${lastIndex}`;
  if (turn.tokensBefore === null) return `Rewinds to before this message · ${discards}`;
  const frees = current !== null && current > turn.tokensBefore ? ` (frees ${formatTokens(current - turn.tokensBefore)})` : "";
  return `Rewinds to ≈${formatTokens(turn.tokensBefore)}${frees} · ${discards}`;
}

function RewindEditor({
  threadId,
  turn,
  lastIndex,
  current,
  blocker,
  onClose,
  onChanged,
}: {
  threadId: string;
  turn: Turn;
  lastIndex: number;
  current: number | null;
  blocker: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const sdk = useSdk();
  const [text, setText] = useState(turn.text);
  const [pending, setPending] = useState(false);
  const rerun = async () => {
    setPending(true);
    try {
      await sdk.threads.editMessage({
        threadId,
        expectedRequestSequence: turn.requestSeq,
        operationId: crypto.randomUUID(),
        input: [{ type: "text", text, mentions: [] }],
      });
      toast.success(`Rerunning from turn ${turn.index}`);
      onClose();
      onChanged();
    } catch (cause) {
      toast.error(`Couldn't edit the message: ${message(cause)}`);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-2 border-l-2 border-border bg-muted/30 px-4 py-3" role="group" aria-label={`Edit turn ${turn.index}`}>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label={`Message for turn ${turn.index}`}
        rows={Math.min(10, Math.max(3, text.split("\n").length))}
        className="text-sm"
        autoFocus
      />
      {turn.textTruncated ? (
        <p className="text-xs text-warning-text">
          This message was too long to load in full; only its beginning is shown and Rerun sends exactly this text.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground" data-rewind-summary>
        {rewindSummary(turn, lastIndex, current)}
      </p>
      <div className="flex items-center justify-end gap-2">
        {blocker === null ? null : <span className="mr-auto text-xs text-muted-foreground">{blocker}</span>}
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={rerun}
          disabled={pending || blocker !== null || text.trim() === ""}
        >
          {pending ? "Rerunning…" : "Rerun"}
        </Button>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  blocker,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  blocker: string | null;
  onClick: () => void;
}) {
  return (
    <span title={blocker ?? label} className="inline-flex">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-xs"
        disabled={blocker !== null}
        onClick={onClick}
      >
        {icon}
        {label}
      </Button>
    </span>
  );
}

function TurnRow({
  threadId,
  turn,
  lastIndex,
  current,
  contextWindow,
  busy,
  flashing,
  onChanged,
}: {
  threadId: string;
  turn: Turn;
  lastIndex: number;
  current: number | null;
  contextWindow: number | null;
  busy: boolean;
  flashing: boolean;
  onChanged: () => void;
}) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [editing, setEditing] = useState(false);
  const blocker = actionBlocker(turn, busy);
  const greyed = turn.state !== "inContext";
  const fork = async () => {
    try {
      const forked = await sdk.threads.fork({ sourceThreadId: threadId, sourceSeqEnd: turn.lastSeq });
      toast.success(`Forked from turn ${turn.index}`);
      navigate.toThread(forked.id);
    } catch (cause) {
      toast.error(`Couldn't fork: ${message(cause)}`);
    }
  };
  const delta = added(turn);
  return (
    <li data-turn={turn.index} aria-label={`Turn ${turn.index}`}>
      <div
        className={cn(
          "group flex min-w-0 items-center gap-2 px-4 py-1.5 text-sm transition-colors duration-700",
          flashing ? "bg-accent" : "hover:bg-muted/40",
          greyed && "text-muted-foreground",
        )}
      >
        <span className="w-7 shrink-0 tabular-nums text-xs text-muted-foreground">#{turn.index}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate", greyed ? "text-muted-foreground" : "text-foreground")} title={turn.preview}>
            {turn.preview}
          </span>
          {greyed || turn.running ? (
            <span className="text-[11px] text-muted-foreground">
              {turn.running ? "running" : turn.state === "summarized" ? "summarized by compaction" : "cleared"}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:hidden">
          <ActionButton
            label="Edit from here…"
            icon={<Icon name="Edit" className="size-3.5" aria-hidden />}
            blocker={blocker}
            onClick={() => setEditing(true)}
          />
          <ActionButton
            label="Fork from here"
            icon={<Icon name={FORK_ICON} className="size-3.5" aria-hidden />}
            blocker={blocker}
            onClick={fork}
          />
        </span>
        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground" title="Added by this turn">
          {delta ?? ""}
        </span>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums" title="Context after this turn">
          {turn.tokensAfter === null ? "" : formatTokens(turn.tokensAfter)}
        </span>
        <MiniBar tokens={turn.tokensAfter} contextWindow={contextWindow} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6 shrink-0" aria-label={`Actions for turn ${turn.index}`}>
              <Icon name="MoreHorizontal" className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" mobileTitle={`Turn ${turn.index}`}>
            <DropdownMenuItem disabled={blocker !== null} onSelect={() => setEditing(true)} title={blocker ?? undefined}>
              <Icon name="Edit" aria-hidden />
              Edit from here…
            </DropdownMenuItem>
            <DropdownMenuItem disabled={blocker !== null} onSelect={fork} title={blocker ?? undefined}>
              <Icon name={FORK_ICON} aria-hidden />
              Fork from here
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editing ? (
        <RewindEditor
          threadId={threadId}
          turn={turn}
          lastIndex={lastIndex}
          current={current}
          blocker={blocker}
          onClose={() => setEditing(false)}
          onChanged={onChanged}
        />
      ) : null}
    </li>
  );
}

export function Turns({
  threadId,
  turns,
  courseChanges,
  current,
  contextWindow,
  busy,
  flash,
  onChanged,
}: {
  threadId: string;
  turns: readonly Turn[];
  courseChanges: readonly CourseChange[];
  current: number | null;
  contextWindow: number | null;
  busy: boolean;
  flash: TurnFlash | null;
  onChanged: () => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const [flashing, setFlashing] = useState<number | null>(null);
  useEffect(() => {
    if (flash === null) return;
    const row = listRef.current?.querySelector(`[data-turn="${flash.turnIndex}"]`);
    row?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setFlashing(flash.turnIndex);
    const id = setTimeout(() => setFlashing(null), 1_200);
    return () => clearTimeout(id);
  }, [flash]);
  const lastIndex = turns.length === 0 ? 0 : turns[turns.length - 1]!.index;
  const dividersBefore = (index: number) =>
    courseChanges
      .filter((change) => change.beforeTurnIndex === index)
      .map((change) => <CourseChangeRow key={`${change.kind}-${change.seq}`} change={change} />);
  const trailing = courseChanges
    .filter((change) => change.beforeTurnIndex > lastIndex)
    .map((change) => <CourseChangeRow key={`${change.kind}-${change.seq}`} change={change} />);
  return (
    <ol ref={listRef} aria-label="Turns">
      {turns.map((turn) => [
        ...dividersBefore(turn.index),
        <TurnRow
          key={`turn-${turn.requestSeq}`}
          threadId={threadId}
          turn={turn}
          lastIndex={lastIndex}
          current={current}
          contextWindow={contextWindow}
          busy={busy}
          flashing={flashing === turn.index}
          onChanged={onChanged}
        />,
      ])}
      {trailing}
    </ol>
  );
}
