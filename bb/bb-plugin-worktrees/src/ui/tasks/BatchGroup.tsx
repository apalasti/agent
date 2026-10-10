import { Group, Mono, Row, RowButton, RowTitle } from "../../kit";
import type { EffortModel } from "./model";
import type { Modifiers } from "./useLaunch";

export function BatchGroup({
  slug,
  batch,
  busy,
  onOpenThread,
  onOrchestrate,
}: {
  slug: string;
  batch: EffortModel["batch"];
  busy: string | null;
  onOpenThread: (threadId: string) => void;
  onOrchestrate: (event: Modifiers) => void;
}) {
  if (batch.open.length === 0) return null;
  const { threadId } = batch;
  return (
    <Group label={`${slug} issues`} aside={`${batch.open.length} open · run as one batch`}>
      <ul>
        {batch.open.map((issue) => (
          <li key={issue.ref}>
            <Row>
              <Mono className="w-5 shrink-0 tabular-nums text-muted-foreground">{issue.number}</Mono>
              <RowTitle title={issue.title}>{issue.title}</RowTitle>
            </Row>
          </li>
        ))}
      </ul>
      <div className="px-3 py-1">
        {threadId !== null ? (
          <RowButton aria-label={`Open ${slug} batch thread`} onClick={() => onOpenThread(threadId)}>
            Open
          </RowButton>
        ) : (
          <RowButton disabled={busy !== null} onClick={onOrchestrate}>
            {busy === `${slug}/orchestrate` ? "Starting…" : "Orchestrate"}
          </RowButton>
        )}
      </div>
    </Group>
  );
}
