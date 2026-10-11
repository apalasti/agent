import { Card, CardHeader, CardSection, CollapsibleLabel, Meter, STATUS, Words } from "../../kit";
import type { EffortModel, TaskRow, TaskState } from "./model";
import { STATE_LABEL, STATE_STATUS } from "./tone";
import { CARD_ROW, TicketRow } from "./TicketRow";
import type { Modifiers } from "./useLaunch";

const GROUPS: readonly TaskState[] = ["running", "ready", "blocked", "done"];

export function EffortCard({
  model,
  busy,
  doneExpanded,
  onToggleDone,
  onOpenThread,
  onRun,
}: {
  model: EffortModel;
  busy: string | null;
  doneExpanded: boolean;
  onToggleDone: () => void;
  onOpenThread: (threadId: string) => void;
  onRun: (row: TaskRow, event: Modifiers) => void;
}) {
  const { done, total } = model.progress;
  const states = GROUPS.filter((state) => model.groups[state].length > 0);

  return (
    <Card label={model.slug}>
      <CardHeader title={model.slug} aside={total > 0 ? `${done}/${total}` : null} />
      {states.length > 0 ? (
        <Words>
          {states.map((state) => (
            <span key={state} className={STATUS[STATE_STATUS[state]].tone}>
              {model.groups[state].length} {STATE_LABEL[state].toLowerCase()}
            </span>
          ))}
        </Words>
      ) : null}
      {total > 0 ? (
        <Meter className="mt-1.5" label={`${model.slug} progress`} max={total} segments={[{ value: done, className: "bg-success" }]} />
      ) : null}

      {states.map((state) => {
        const rows = model.groups[state];
        const collapsible = state === "done";
        const open = !collapsible || doneExpanded;
        const tone = STATUS[STATE_STATUS[state]].tone;
        return (
          <CardSection
            key={state}
            aside={rows.length}
            className={tone}
            label={
              collapsible ? (
                <CollapsibleLabel inset={false} open={open} onToggle={onToggleDone} aside={rows.length} className={tone}>
                  {STATE_LABEL[state]}
                </CollapsibleLabel>
              ) : (
                STATE_LABEL[state]
              )
            }
          >
            {open ? (
              <ul>
                {rows.map((row) => (
                  <TicketRow key={row.ref} row={row} busy={busy} className={CARD_ROW} onOpenThread={onOpenThread} onRun={onRun} />
                ))}
              </ul>
            ) : null}
          </CardSection>
        );
      })}
    </Card>
  );
}
