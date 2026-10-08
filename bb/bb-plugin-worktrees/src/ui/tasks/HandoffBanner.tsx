import { Button } from "@/components/ui/button";
import type { Modifiers } from "./useLaunch";

export function HandoffBanner({ slug, busy, onHandoff }: { slug: string; busy: string | null; onHandoff: (event: Modifiers) => void }) {
  return (
    <div className="mx-3 flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">Every ticket is closed — hand the map off to a PRD and issues</span>
      <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={onHandoff}>
        {busy === `${slug}/handoff` ? "Starting…" : "Hand off"}
      </Button>
    </div>
  );
}
