import { Card, CardHeader, Mono, Row, RowButton, RowTitle, Words } from "../../kit";
import type { EffortModel } from "./model";
import { CARD_ROW } from "./TicketRow";
import type { Modifiers } from "./useLaunch";

export function BatchCard({
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
    <Card label={`${slug} issues`}>
      <CardHeader title={`${slug} issues`} aside={`${batch.open.length} open`} />
      <Words>Run as one batch</Words>
      <ul className="mt-3">
        {batch.open.map((issue) => (
          <li key={issue.ref}>
            <Row className={CARD_ROW}>
              <Mono className="w-5 shrink-0 tabular-nums text-muted-foreground">{issue.number}</Mono>
              <RowTitle title={issue.title}>{issue.title}</RowTitle>
            </Row>
          </li>
        ))}
      </ul>
      <div className="mt-2">
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
    </Card>
  );
}
