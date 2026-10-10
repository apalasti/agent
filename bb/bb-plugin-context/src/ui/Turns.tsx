import { useEffect, useRef, useState } from "react";
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
import { Callout, Meter, StatusWord } from "../kit";
import { CourseChangeRow } from "./CourseChangeRow";
import { formatTokens } from "./format";
import { FORK_ICON } from "./icon";
import { RowMenuTrigger } from "./RowAction";

export type TurnFlash = { turnIndex: number; nonce: number };

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const WAIT_FOR_TURN = "Wait for the current turn to finish";

/** Why "Edit from here" is unavailable, or null when it is available. */
export function editBlocker(turn: Turn, busy: boolean): string | null {
  if (busy || turn.running) return WAIT_FOR_TURN;
  if (!turn.editable) return turn.notEditableReason ?? "This message can't be edited";
  return null;
}

/** Why "Fork from here" is unavailable; any completed turn can be forked, whoever sent it. */
export function forkBlocker(turn: Turn, busy: boolean): string | null {
  return busy || turn.running ? WAIT_FOR_TURN : null;
}

/** bb prefixes messages sent by another thread with a sender header that would fill the one-line preview. */
export function displayPreview(preview: string): string {
  return preview.replace(/^\[bb message from [^\]]*\]\s*/, "") || preview;
}

function added(turn: Turn): string | null {
  if (turn.tokensAfter === null || turn.tokensBefore === null) return null;
  const delta = turn.tokensAfter - turn.tokensBefore;
  return `${turn.measured ? "" : "≈"}${delta >= 0 ? "+" : ""}${formatTokens(delta)}`;
}

function MiniBar({ tokens, contextWindow }: { tokens: number | null; contextWindow: number | null }) {
  const known = tokens !== null && contextWindow !== null && contextWindow > 0;
  return (
    <span aria-hidden="true" className="hidden w-12 shrink-0 @[22rem]:block">
      <Meter
        segments={[{ value: known ? tokens : 0, className: "bg-foreground/45" }]}
        max={known ? contextWindow : 1}
        label="Context after this turn"
      />
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
    <div className="space-y-2 bg-surface-recessed px-3 py-3" role="group" aria-label={`Edit turn ${turn.index}`}>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label={`Message for turn ${turn.index}`}
        rows={Math.min(10, Math.max(3, text.split("\n").length))}
        className="text-sm"
        autoFocus
      />
      {turn.textTruncated ? (
        <Callout tone="warning" className="mx-0 my-0">
          This message was too long to load in full; only its beginning is shown and Rerun sends exactly this text.
        </Callout>
      ) : null}
      <p className="text-xs text-muted-foreground" data-rewind-summary>
        {rewindSummary(turn, lastIndex, current)}
      </p>
      <div className="flex items-center justify-end gap-2">
        {blocker === null ? null : <span className="mr-auto text-xs text-subtle-foreground">{blocker}</span>}
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

function TurnMenuItem({
  label,
  icon,
  blocker,
  onSelect,
}: {
  label: string;
  icon: string;
  blocker: string | null;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem disabled={blocker !== null} onSelect={onSelect} className="items-start">
      <Icon name={icon} aria-hidden className="mt-px" />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {blocker === null ? null : <span className="max-w-56 text-xs text-subtle-foreground">{blocker}</span>}
      </span>
    </DropdownMenuItem>
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
  const editBlocked = editBlocker(turn, busy);
  const forkBlocked = forkBlocker(turn, busy);
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
          "group/row flex min-h-7 min-w-0 items-center gap-2 px-3 py-1 text-sm transition-colors duration-700",
          flashing ? "bg-state-active" : "hover:bg-state-hover hover:duration-0",
          greyed && "text-muted-foreground",
        )}
      >
        <span className="w-7 shrink-0 text-xs tabular-nums text-subtle-foreground">#{turn.index}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate", greyed ? "text-muted-foreground" : "text-foreground")} title={turn.preview}>
            {displayPreview(turn.preview)}
          </span>
          {turn.running ? (
            <span className="text-xs">
              <StatusWord status="running">running</StatusWord>
            </span>
          ) : greyed ? (
            <span className="text-xs text-subtle-foreground">{turn.state === "summarized" ? "summarized by compaction" : "cleared"}</span>
          ) : null}
        </span>
        <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums text-subtle-foreground @[18rem]:inline" title="Added by this turn">
          {delta ?? ""}
        </span>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums" title="Context after this turn">
          {turn.tokensAfter === null ? "" : formatTokens(turn.tokensAfter)}
        </span>
        <MiniBar tokens={turn.tokensAfter} contextWindow={contextWindow} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <RowMenuTrigger label={`Actions for turn ${turn.index}`} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" mobileTitle={`Turn ${turn.index}`}>
            <TurnMenuItem label="Edit from here…" icon="Edit" blocker={editBlocked} onSelect={() => setEditing(true)} />
            <TurnMenuItem label="Fork from here" icon={FORK_ICON} blocker={forkBlocked} onSelect={fork} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editing ? (
        <RewindEditor
          threadId={threadId}
          turn={turn}
          lastIndex={lastIndex}
          current={current}
          blocker={editBlocked}
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
