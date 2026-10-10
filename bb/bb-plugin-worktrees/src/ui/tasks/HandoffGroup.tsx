import { Group, RowButton } from "../../kit";
import type { Modifiers } from "./useLaunch";

export function HandoffGroup({ slug, busy, onHandoff }: { slug: string; busy: string | null; onHandoff: (event: Modifiers) => void }) {
  return (
    <Group label="Hand off">
      <div className="flex items-center gap-2 px-3 py-1">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">Every ticket is closed — hand the map off to a PRD and issues</span>
        <RowButton disabled={busy !== null} onClick={onHandoff}>
          {busy === `${slug}/handoff` ? "Starting…" : "Hand off"}
        </RowButton>
      </div>
    </Group>
  );
}
