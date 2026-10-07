import { useState, type ReactNode } from "react";
import { useSdk, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { ContextReport } from "../contract";
import { Breakdown } from "./Breakdown";
import { useReport } from "./data";
import {
  CATEGORY_STYLE,
  formatTokens,
  isBusy,
  percent,
  TONE_TEXT,
  toneFor,
  usableLimit,
  usedTotal,
} from "./format";
import { CLEAR_ICON, COMPACT_ICON } from "./icon";
import { MeterBar } from "./MeterBar";
import { Turns, type TurnFlash } from "./Turns";

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function StatusBox({ children, role = "status" }: { children: ReactNode; role?: "status" | "alert" }) {
  return (
    <div className="p-4">
      <div
        role={role}
        className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
      >
        {children}
      </div>
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-border py-2">
      <div className="flex items-baseline justify-between px-4 pb-1 pt-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

const SOURCE_NOTE: Record<ContextReport["source"]["kind"], string> = {
  "pi-session": "breakdown from the pi session",
  "claude-transcript": "breakdown from the Claude Code transcript",
  "claude-snapshot": "breakdown from Claude Code's /context and the transcript",
  "bb-only": "no breakdown available",
};

export function basisLine(report: ContextReport): string {
  const parts = [
    report.window.basis === "measured" ? "Measured by bb" : "Estimated by this plugin",
    SOURCE_NOTE[report.source.kind],
  ];
  if (report.window.model !== null) parts.push(report.window.model);
  return parts.join(" · ");
}

function Header({ report, used }: { report: ContextReport; used: number }) {
  const { window } = report;
  const tone = toneFor(used, usableLimit(window));
  const tickShare = window.autoCompactAt !== null && window.contextWindow ? window.autoCompactAt / window.contextWindow : null;
  return (
    <header className="space-y-2 px-4 pb-3 pt-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={cn("text-2xl font-semibold tabular-nums", tone === "muted" ? "text-foreground" : TONE_TEXT[tone])}>
          {window.basis === "estimated" ? "≈" : ""}
          {formatTokens(used)}
        </span>
        {window.contextWindow === null ? null : (
          <span className="text-sm tabular-nums text-muted-foreground">/ {formatTokens(window.contextWindow)} tokens</span>
        )}
        <span className={cn("ml-auto text-sm tabular-nums", TONE_TEXT[tone])}>
          {percent(used, window.contextWindow) ?? ""} used
        </span>
      </div>
      <div className="pb-4">
        <div className="relative">
          <MeterBar segments={report.segments} total={window.contextWindow} autoCompactAt={window.autoCompactAt} size="lg" />
          {tickShare === null || tickShare >= 1 ? null : (
            <span
              className={cn(
                "absolute top-5 whitespace-nowrap text-[11px] text-muted-foreground",
                tickShare > 0.5 && "-translate-x-full",
              )}
              style={{ left: `${tickShare * 100}%` }}
            >
              autocompact at {formatTokens(window.autoCompactAt!)}
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-basis>
        {basisLine(report)}
        {window.recomputing ? <span className="italic"> · recomputing after a course change</span> : null}
      </p>
      {report.notes.length === 0 ? null : (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {report.notes.map((note) => (
            <li key={note} className="flex gap-1.5">
              <Icon name="Info" aria-hidden className="mt-px size-3.5 shrink-0" />
              {note}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

function LargestItems({ report, onSelectTurn }: { report: ContextReport; onSelectTurn: (turnIndex: number) => void }) {
  return (
    <ul aria-label="Largest items">
      {report.largest.slice(0, 10).map((item) => {
        const turnIndex = item.turnIndex;
        const content = (
          <>
            <span className={cn("size-2 shrink-0 rounded-full", CATEGORY_STYLE[item.categoryId].dot)} />
            <span className="min-w-0 max-w-[50%] shrink-0 truncate text-foreground" title={item.label}>
              {item.label}
            </span>
            {item.detail === null ? null : (
              <span title={item.detail} className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                {item.detail}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {turnIndex === null ? "" : `#${turnIndex}`}
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums">{formatTokens(item.tokens)}</span>
          </>
        );
        const rowClass = "flex w-full min-w-0 items-center gap-2 px-4 py-1 text-left text-xs";
        return (
          <li key={`${item.categoryId}-${item.id}`}>
            {turnIndex === null ? (
              <div className={rowClass}>{content}</div>
            ) : (
              <button
                type="button"
                className={cn(rowClass, "hover:bg-muted/50")}
                onClick={() => onSelectTurn(turnIndex)}
                title={`Show turn ${turnIndex}`}
              >
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ConfirmAction({
  label,
  icon,
  title,
  description,
  confirmLabel,
  disabledReason,
  run,
}: {
  label: string;
  icon: string;
  title: string;
  description: string;
  confirmLabel: string;
  disabledReason: string | null;
  run: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <AlertDialog>
      <span title={disabledReason ?? undefined} className="inline-flex">
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabledReason !== null || pending}>
            <Icon name={icon} aria-hidden />
            {label}
          </Button>
        </AlertDialogTrigger>
      </span>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              setPending(true);
              try {
                await run();
              } finally {
                setPending(false);
              }
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Footer({ threadId, used, busy, onChanged }: { threadId: string; used: number; busy: boolean; onChanged: () => void }) {
  const sdk = useSdk();
  const disabledReason = busy ? "Wait for the current turn to finish" : null;
  const size = formatTokens(used);
  return (
    <footer className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
      <ConfirmAction
        label="Compact"
        icon={COMPACT_ICON}
        title="Compact the context?"
        description={`The context holds ${size} tokens. The agent summarizes the conversation so far and continues from that summary; older turns stay visible but leave the context.`}
        confirmLabel="Compact"
        disabledReason={disabledReason}
        run={async () => {
          try {
            await sdk.threads.compact({ threadId });
            toast.success("Compacting the context");
            onChanged();
          } catch (cause) {
            toast.error(`Couldn't compact: ${message(cause)}`);
          }
        }}
      />
      <ConfirmAction
        label="Clear context"
        icon={CLEAR_ICON}
        title="Clear the context?"
        description={`The context holds ${size} tokens. Clearing starts the agent from an empty conversation; the messages stay visible in the thread but the agent no longer sees them.`}
        confirmLabel="Clear context"
        disabledReason={disabledReason}
        run={async () => {
          try {
            await sdk.threads.clearContext({ threadId });
            toast.success("Context cleared");
            onChanged();
          } catch (cause) {
            toast.error(`Couldn't clear the context: ${message(cause)}`);
          }
        }}
      />
    </footer>
  );
}

function ReportView({ threadId, report, refetch }: { threadId: string; report: ContextReport; refetch: () => void }) {
  const [flash, setFlash] = useState<TurnFlash | null>(null);
  const selectTurn = (turnIndex: number) => setFlash((previous) => ({ turnIndex, nonce: (previous?.nonce ?? 0) + 1 }));
  const used = usedTotal(report.window, report.segments);
  const busy = isBusy(report.threadStatus);
  return (
    <>
      <Header report={report} used={used} />
      {report.categories.length === 0 ? null : (
        <Section title="What's in it">
          <Breakdown
            categories={report.categories}
            used={used}
            contextWindow={report.window.contextWindow}
            onSelectTurn={selectTurn}
          />
        </Section>
      )}
      {report.largest.length === 0 ? null : (
        <Section title="Largest items">
          <LargestItems report={report} onSelectTurn={selectTurn} />
        </Section>
      )}
      <Section
        title="Turns"
        aside={busy ? <span className="text-[11px] text-muted-foreground">running…</span> : null}
      >
        {report.turns.length === 0 ? (
          <p className="px-4 py-2 text-xs text-muted-foreground">No messages in the active timeline.</p>
        ) : (
          <Turns
            threadId={threadId}
            turns={report.turns}
            courseChanges={report.courseChanges}
            current={used}
            contextWindow={report.window.contextWindow}
            busy={busy}
            flash={flash}
            onChanged={refetch}
          />
        )}
      </Section>
      <Footer threadId={threadId} used={used} busy={busy} onChanged={refetch} />
    </>
  );
}

export function ContextPanel({ threadId }: PluginThreadPanelProps) {
  const { report, error, refetch } = useReport(threadId);
  let body: ReactNode;
  if (report === null && error !== null) {
    body = (
      <StatusBox role="alert">
        <p className="text-destructive">Couldn't load the context: {error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={refetch}>
          Retry
        </Button>
      </StatusBox>
    );
  } else if (report === null) {
    body = <StatusBox>Loading context…</StatusBox>;
  } else if (report.window.basis === "none" && report.turns.length === 0) {
    body = <StatusBox>No context recorded yet: send a message first.</StatusBox>;
  } else {
    body = (
      <>
        {error === null ? null : (
          <p role="alert" className="flex items-center gap-2 px-4 pt-3 text-xs text-destructive">
            Couldn't refresh: {error}
            <button type="button" className="underline" onClick={refetch}>
              Retry
            </button>
          </p>
        )}
        <ReportView threadId={threadId} report={report} refetch={refetch} />
      </>
    );
  }
  return <div className="@container h-full min-h-0 overflow-y-auto">{body}</div>;
}
