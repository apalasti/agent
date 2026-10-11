import { Card, CardHeader, CardText, RowButton } from "../../kit";
import type { Modifiers } from "./useLaunch";

export function HandoffCard({ slug, busy, onHandoff }: { slug: string; busy: string | null; onHandoff: (event: Modifiers) => void }) {
  return (
    <Card label={`${slug} hand-off`}>
      <CardHeader title={`${slug} hand-off`} />
      <CardText>Every ticket is closed — hand the map off to a PRD and issues</CardText>
      <div className="mt-2">
        <RowButton disabled={busy !== null} onClick={onHandoff}>
          {busy === `${slug}/handoff` ? "Starting…" : "Hand off"}
        </RowButton>
      </div>
    </Card>
  );
}
