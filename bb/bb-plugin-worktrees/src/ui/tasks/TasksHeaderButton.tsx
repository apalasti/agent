import { useEffect, useState } from "react";
import { useBbNavigate, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ScratchSummary } from "../../contract";
import { useRefreshEpoch, useThreadWorktree, useWorktreesRpc } from "../data";
import { scratchSummaryText } from "../rows";

export const TASKS_PANEL_ACTION_ID = "tasks";

export function TasksHeaderButton({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const located = useThreadWorktree(threadId);
  if (located.status !== "found") return null;
  return <WorktreeTasksButton projectId={located.projectId} path={located.path} compact={isCompactViewport} />;
}

function WorktreeTasksButton({ projectId, path, compact }: { projectId: string; path: string; compact: boolean }) {
  const rpc = useWorktreesRpc();
  const navigate = useBbNavigate();
  const epoch = useRefreshEpoch();
  const [summary, setSummary] = useState<ScratchSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.call("scratchSummary", { projectId, path }).then(
      (next) => !cancelled && setSummary(next),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, path, epoch]);

  const text = summary === null ? null : scratchSummaryText(summary);
  const count = summary === null ? 0 : summary.readyTickets + summary.openIssues + summary.handoffs;
  return (
    <TooltipProvider>
      <Tooltip delayDuration={350} disableHoverableContent>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs tabular-nums"
            aria-label={text === null ? "Open Tasks" : `Open Tasks: ${text}`}
            onClick={() => navigate.openThreadPanel({ actionId: TASKS_PANEL_ACTION_ID })}
          >
            <Icon name="ListTodo" className="size-3.5" aria-hidden="true" />
            {compact ? null : "Tasks"}
            {count > 0 ? <span className="text-muted-foreground">{count}</span> : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{text ?? "Open Tasks"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
