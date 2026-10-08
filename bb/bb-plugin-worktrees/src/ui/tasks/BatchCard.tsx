import { Button } from "@/components/ui/button";
import type { EffortModel } from "./model";
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
    <div className="mx-3 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="text-xs font-medium">Issues</span>
        <span className="min-w-0 flex-1 truncate text-xs text-subtle-foreground">{batch.open.length} open · run as one batch</span>
        {threadId !== null ? (
          <Button size="sm" variant="outline" className="h-7" aria-label={`Open ${slug} batch thread`} onClick={() => onOpenThread(threadId)}>
            Open
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={onOrchestrate}>
            {busy === `${slug}/orchestrate` ? "Starting…" : "Orchestrate"}
          </Button>
        )}
      </div>
      <ul className="grid border-t border-border py-0.5">
        {batch.open.map((issue) => (
          <li key={issue.ref} className="flex min-h-7 items-center gap-2 px-2.5 text-xs">
            <span className="w-5 shrink-0 font-mono text-muted-foreground">{issue.number}</span>
            <span className="min-w-0 flex-1 truncate" title={issue.title}>
              {issue.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
