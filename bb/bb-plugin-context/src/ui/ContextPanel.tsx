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
import { Callout, Dot, Hint, PanelBody, PanelFooter, PanelState, SectionLabel, Spinner } from "../kit";
import { Breakdown } from "./Breakdown";
import { useReport } from "./data";
import {
  CATEGORY_FILL,
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
import { RowAction } from "./RowAction";
import { Turns, type TurnFlash } from "./Turns";

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-border-hairline pb-1">
      <SectionLabel aside={aside}>{title}</SectionLabel>
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
  return [report.window.basis === "measured" ? "Measured by bb" : "Estimated by this plugin", SOURCE_NOTE[report.source.kind]].join(" · ");
}

function Header({ report, used }: { report: ContextReport; used: number }) {
  const { window } = report;
  const tone = toneFor(used, usableLimit(window));
  const tickShare = window.autoCompactAt !== null && window.contextWindow ? window.autoCompactAt / window.contextWindow : null;
  return (
    <header className="space-y-2 px-3 pb-3 pt-4">
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
                "absolute top-5 whitespace-nowrap text-xs tabular-nums text-subtle-foreground",
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
        {window.model === null ? null : (
          <>
            {" · "}
            <span className="font-mono">{window.model}</span>
          </>
        )}
        {window.recomputing ? <span className="text-subtle-foreground"> · recomputing after a course change</span> : null}
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
            <Dot className={CATEGORY_FILL[item.categoryId]} />
            <span className="min-w-0 max-w-[50%] shrink-0 truncate text-foreground" title={item.label}>
              {item.label}
            </span>
            {item.detail === null ? null : (
              <span title={item.detail} className="min-w-0 truncate font-mono text-xs text-subtle-foreground">
                {item.detail}
              </span>
            )}
            <span className="ml-auto shrink-0 text-xs tabular-nums text-subtle-foreground">
              {turnIndex === null ? "" : `#${turnIndex}`}
            </span>
            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatTokens(item.tokens)}</span>
          </>
        );
        return (
          <li key={`${item.categoryId}-${item.id}`}>
            {turnIndex === null ? (
              <div className="flex h-7 min-w-0 items-center gap-2 px-3 text-sm hover:bg-state-hover">{content}</div>
            ) : (
              <Hint label={`Show turn ${turnIndex}`}>
                <RowAction onClick={() => onSelectTurn(turnIndex)}>{content}</RowAction>
              </Hint>
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
  destructive = false,
  disabledReason,
  run,
}: {
  label: string;
  icon: string;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  disabledReason: string | null;
  run: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const trigger = (
    <AlertDialogTrigger asChild>
      <Button variant="outline" size="sm" disabled={disabledReason !== null || pending}>
        <Icon name={icon} aria-hidden />
        {label}
      </Button>
    </AlertDialogTrigger>
  );
  return (
    <AlertDialog>
      {disabledReason === null ? (
        trigger
      ) : (
        <Hint label={disabledReason}>
          <span className="inline-flex">{trigger}</span>
        </Hint>
      )}
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant={destructive ? "destructive" : "default"}
              size="sm"
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
            </Button>
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
    <PanelFooter>
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
        destructive
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
      {disabledReason === null ? null : <p className="w-full text-xs text-subtle-foreground">{disabledReason}</p>}
    </PanelFooter>
  );
}

function ReportView({
  threadId,
  report,
  error,
  refetch,
}: {
  threadId: string;
  report: ContextReport;
  error: string | null;
  refetch: () => void;
}) {
  const [flash, setFlash] = useState<TurnFlash | null>(null);
  const selectTurn = (turnIndex: number) => setFlash((previous) => ({ turnIndex, nonce: (previous?.nonce ?? 0) + 1 }));
  const used = usedTotal(report.window, report.segments);
  const busy = isBusy(report.threadStatus);
  return (
    <>
      <PanelBody>
        {error === null ? null : (
          <Callout tone="error" onRetry={refetch}>
            Couldn't refresh: {error}
          </Callout>
        )}
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
          aside={
            busy ? (
              <span className="inline-flex items-center gap-1">
                <Spinner />
                running…
              </span>
            ) : null
          }
        >
          {report.turns.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No messages in the active timeline.</p>
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
      </PanelBody>
      <Footer threadId={threadId} used={used} busy={busy} onChanged={refetch} />
    </>
  );
}

export function ContextPanel({ threadId }: PluginThreadPanelProps) {
  const { report, error, refetch } = useReport(threadId);
  let body: ReactNode;
  if (report === null && error !== null) {
    body = (
      <PanelState kind="error" onRetry={refetch}>
        Couldn't load the context: {error}
      </PanelState>
    );
  } else if (report === null) {
    body = <PanelState kind="loading">Loading context…</PanelState>;
  } else if (report.window.basis === "none" && report.turns.length === 0) {
    body = <PanelState kind="empty">No context recorded yet: send a message first.</PanelState>;
  } else {
    body = <ReportView threadId={threadId} report={report} error={error} refetch={refetch} />;
  }
  return <div className="@container flex h-full min-h-0 flex-col">{body}</div>;
}
