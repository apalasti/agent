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
import type { ContextReport } from "../contract";
import {
  ActionRow,
  Callout,
  DisclosureHeader,
  Dot,
  Group,
  Hint,
  PanelBody,
  PanelFooter,
  PanelState,
  SectionLabel,
  Spinner,
  Words,
} from "../kit";
import { Breakdown } from "./Breakdown";
import { useReport } from "./data";
import { CATEGORY_FILL, formatTokens, isBusy, TONE_TEXT, toneFor, usableLimit, usageLabel, usedTotal } from "./format";
import { CLEAR_ICON, COMPACT_ICON } from "./icon";
import { MeterBar } from "./MeterBar";
import { Turns, type TurnFlash } from "./Turns";

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const SOURCE_NOTE: Record<ContextReport["source"]["kind"], string> = {
  "pi-session": "Breakdown from the pi session",
  "claude-transcript": "Breakdown from the Claude Code transcript",
  "claude-snapshot": "Breakdown from Claude Code's /context and the transcript",
  "bb-only": "No breakdown available",
};

function ContextWindowSection({
  report,
  used,
  onSelectTurn,
}: {
  report: ContextReport;
  used: number;
  onSelectTurn: (turnIndex: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const { window } = report;
  const tone = toneFor(used, usableLimit(window));
  const aside = <span className={TONE_TEXT[tone]}>{usageLabel(window, used)}</span>;
  const hasBreakdown = report.categories.length > 0;
  return (
    <section aria-label="Context window" className="pb-2">
      <header className="space-y-2 pb-1">
        {hasBreakdown ? (
          <DisclosureHeader title="Context window" aside={aside} open={open} onToggle={() => setOpen((value) => !value)} />
        ) : (
          <SectionLabel aside={aside}>Context window</SectionLabel>
        )}
        <div className="space-y-2 px-3">
          <MeterBar segments={report.segments} total={window.contextWindow} autoCompactAt={window.autoCompactAt} />
          <div data-basis>
            <Words className="text-xs">
              <span>{window.basis === "measured" ? "Measured by bb" : "Estimated by this plugin"}</span>
              <span>{SOURCE_NOTE[report.source.kind]}</span>
              {window.model === null ? null : <span className="font-mono">{window.model}</span>}
              {window.autoCompactAt === null ? null : <span>Autocompact at {formatTokens(window.autoCompactAt)}</span>}
              {window.recomputing ? <span className="text-subtle-foreground">Recomputing after a course change</span> : null}
            </Words>
          </div>
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
        </div>
      </header>
      {hasBreakdown && open ? (
        <Breakdown categories={report.categories} used={used} contextWindow={window.contextWindow} onSelectTurn={onSelectTurn} />
      ) : null}
    </section>
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
              <div className="flex h-7 min-w-0 items-center gap-2 px-3 text-sm">{content}</div>
            ) : (
              <Hint label={`Show turn ${turnIndex}`}>
                <ActionRow onClick={() => onSelectTurn(turnIndex)}>{content}</ActionRow>
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
        <ContextWindowSection report={report} used={used} onSelectTurn={selectTurn} />
        {report.largest.length === 0 ? null : (
          <Group label="Largest items" aria-label="Largest items">
            <LargestItems report={report} onSelectTurn={selectTurn} />
          </Group>
        )}
        <Group label="Turns" aria-label="Turns"
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
        </Group>
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
