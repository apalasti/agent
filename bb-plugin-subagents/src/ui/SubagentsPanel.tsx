import type { ReactNode } from "react";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentCard } from "./AgentCard";
import { useNow, useThreadSubagents } from "./data";
import { orderSubagents, panelSummary, tally } from "./format";
import { RunningGlyph } from "./glyphs";

function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

export function SubagentsPanel({ threadId }: PluginThreadPanelProps) {
  const { subagents, environment, error, refetch } = useThreadSubagents(threadId);
  const ordered = subagents === null ? null : orderSubagents(subagents);
  const counts = subagents === null ? null : tally(subagents);
  const now = useNow(counts !== null && counts.running > 0);

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
          {counts !== null && counts.running > 0 ? <RunningGlyph className="size-3.5" /> : null}
          <span className="min-w-0 flex-1 truncate tabular-nums">{subagents === null ? null : panelSummary(subagents, now)}</span>
          <button
            type="button"
            aria-label="Refresh subagents"
            onClick={refetch}
            className="inline-flex size-7 items-center justify-center rounded-md text-subtle-foreground outline-none hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="RotateCcw" aria-hidden className="size-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-2 p-3">
            {error !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {ordered === null ? (
              error === null ? <Notice>Loading subagents…</Notice> : null
            ) : ordered.length === 0 ? (
              <Notice>
                No subagents in this thread yet. This panel shows pi subagents launched with the <code>Agent</code> tool,
                each with its live transcript.
              </Notice>
            ) : (
              ordered.map((agent) => <AgentCard key={agent.callId} threadId={threadId} agent={agent} environment={environment} />)
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
