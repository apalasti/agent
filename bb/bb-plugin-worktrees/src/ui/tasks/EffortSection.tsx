import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { BatchCard } from "./BatchCard";
import { HandoffBanner } from "./HandoffBanner";
import type { EffortModel, TaskRow, TaskState } from "./model";
import { STATE_DOT, STATE_LABEL, STATE_TEXT } from "./tone";
import { TicketRow } from "./TicketRow";
import type { Modifiers } from "./useLaunch";

const GROUPS: readonly TaskState[] = ["running", "ready", "blocked", "done"];

export function EffortSection({
  model,
  busy,
  doneExpanded,
  onToggleDone,
  onOpenThread,
  onRun,
  onOrchestrate,
  onHandoff,
}: {
  model: EffortModel;
  busy: string | null;
  doneExpanded: boolean;
  onToggleDone: () => void;
  onOpenThread: (threadId: string) => void;
  onRun: (row: TaskRow, event: Modifiers) => void;
  onOrchestrate: (model: EffortModel, event: Modifiers) => void;
  onHandoff: (slug: string, event: Modifiers) => void;
}) {
  const { done, total } = model.progress;

  return (
    <section className="grid gap-1.5 py-2">
      <div className="px-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-sm font-medium">{model.slug}</h3>
          {total > 0 ? (
            <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
              {done}/{total}
            </span>
          ) : null}
        </div>
        {total > 0 ? (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className={cn("h-full rounded-full", STATE_DOT.done)} style={{ width: `${(done / total) * 100}%` }} />
          </div>
        ) : null}
      </div>

      {GROUPS.map((state) => {
        const rows = model.groups[state];
        if (rows.length === 0) return null;
        const collapsible = state === "done";
        const open = !collapsible || doneExpanded;
        return (
          <div key={state} className="grid px-1">
            <div className="flex items-center px-2">
              {collapsible ? (
                <button
                  type="button"
                  className={cn("flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide", STATE_TEXT[state])}
                  aria-expanded={open}
                  onClick={onToggleDone}
                >
                  <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3" aria-hidden="true" />
                  {STATE_LABEL[state]} · {rows.length}
                </button>
              ) : (
                <span className={cn("text-[11px] font-medium uppercase tracking-wide", STATE_TEXT[state])}>
                  {STATE_LABEL[state]} · {rows.length}
                </span>
              )}
            </div>
            {open ? (
              <ul className="grid">
                {rows.map((row) => (
                  <TicketRow key={row.ref} row={row} busy={busy} onOpenThread={onOpenThread} onRun={onRun} />
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}

      <BatchCard
        slug={model.slug}
        batch={model.batch}
        busy={busy}
        onOpenThread={onOpenThread}
        onOrchestrate={(event) => onOrchestrate(model, event)}
      />
      {model.handoffReady ? <HandoffBanner slug={model.slug} busy={busy} onHandoff={(event) => onHandoff(model.slug, event)} /> : null}
    </section>
  );
}
