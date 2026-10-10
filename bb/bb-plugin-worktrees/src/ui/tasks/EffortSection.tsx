import { Group, Meter, SectionLabel, STATUS } from "../../kit";
import { CollapsibleLabel } from "../CollapsibleLabel";
import { BatchGroup } from "./BatchGroup";
import { HandoffGroup } from "./HandoffGroup";
import type { EffortModel, TaskRow, TaskState } from "./model";
import { STATE_LABEL, STATE_STATUS } from "./tone";
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
    <>
      <Group>
        <div className="px-3 pt-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-sm font-medium">{model.slug}</h3>
            {total > 0 ? (
              <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
                {done}/{total}
              </span>
            ) : null}
          </div>
          {total > 0 ? (
            <Meter className="mt-1.5" label={`${model.slug} progress`} max={total} segments={[{ value: done, className: "bg-success" }]} />
          ) : null}
        </div>

        {GROUPS.map((state) => {
          const rows = model.groups[state];
          if (rows.length === 0) return null;
          const collapsible = state === "done";
          const open = !collapsible || doneExpanded;
          const tone = STATUS[STATE_STATUS[state]].tone;
          return (
            <div key={state}>
              {collapsible ? (
                <CollapsibleLabel open={open} onToggle={onToggleDone} aside={rows.length} className={tone}>
                  {STATE_LABEL[state]}
                </CollapsibleLabel>
              ) : (
                <SectionLabel aside={rows.length} className={tone}>
                  {STATE_LABEL[state]}
                </SectionLabel>
              )}
              {open ? (
                <ul>
                  {rows.map((row) => (
                    <TicketRow key={row.ref} row={row} busy={busy} onOpenThread={onOpenThread} onRun={onRun} />
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </Group>

      <BatchGroup
        slug={model.slug}
        batch={model.batch}
        busy={busy}
        onOpenThread={onOpenThread}
        onOrchestrate={(event) => onOrchestrate(model, event)}
      />
      {model.handoffReady ? <HandoffGroup slug={model.slug} busy={busy} onHandoff={(event) => onHandoff(model.slug, event)} /> : null}
    </>
  );
}
