import { useBbNavigate, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Agent } from "../contract";
import { ContextBar } from "./ContextBar";
import { duration, shortModel } from "./format";
import { liveState } from "./live";
import { useNow, useThreadAgents } from "./useThreadAgents";

export const PANEL_ACTION_ID = "claude-subagents";

export function HeaderPill({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { data } = useThreadAgents(threadId);
  const navigate = useBbNavigate();
  const agents = data?.agents ?? [];
  const running = agents.filter((agent) => agent.status === "running");
  const now = useNow(running.length > 0);
  if (agents.length === 0) return null;

  const label = running.length > 0 ? `${running.length} running` : idleSummary(agents).text;
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Claude subagents: ${label}`}
            onClick={() => navigate.openThreadPanel({ actionId: PANEL_ACTION_ID })}
            className="inline-flex h-7 max-w-80 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs tabular-nums hover:bg-state-hover"
          >
            {running.length > 0 ? (
              <RunningContent running={running} now={now} compact={isCompactViewport} />
            ) : (
              <IdleContent agents={agents} />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-96">
          {running.length > 0 ? <RunningTooltip running={running} now={now} /> : "Open the Claude subagents panel"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function idleSummary(agents: Agent[]): { text: string; icon: string; tone: string } {
  const needLook = agents.filter((agent) => agent.status === "failed" || agent.status === "needs-look").length;
  if (needLook > 0) return { text: `${needLook} need a look`, icon: "AlertTriangle", tone: "text-warning-text" };
  const done = agents.filter((agent) => agent.status === "done").length;
  if (done > 0) return { text: `${done} done`, icon: "CircleCheck", tone: "text-success-foreground" };
  return { text: `${agents.length} unknown`, icon: "CircleQuestion", tone: "text-muted-foreground" };
}

function IdleContent({ agents }: { agents: Agent[] }) {
  const { text, icon, tone } = idleSummary(agents);
  return (
    <>
      <Icon name={icon} aria-hidden className={cn("size-3.5 shrink-0", tone)} />
      <span className={cn("shrink-0 font-medium", tone)}>{text}</span>
    </>
  );
}

function RunningContent({ running, now, compact }: { running: Agent[]; now: number; compact: boolean }) {
  const newest = running[running.length - 1]!;
  const live = liveState(newest, now);
  return (
    <>
      <Icon name="Loading" aria-hidden className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
      <span className="shrink-0 font-medium">{running.length} running</span>
      <ContextBar used={newest.context} window={newest.contextWindow} className="shrink-0" />
      {compact ? null : (
        <span className="min-w-0 truncate font-mono text-muted-foreground">
          {live.label} · {duration(now - live.since)}
        </span>
      )}
    </>
  );
}

function RunningTooltip({ running, now }: { running: Agent[]; now: number }) {
  return (
    <ul className="space-y-1 text-xs">
      {running.map((agent) => {
        const live = liveState(agent, now);
        const percent = agent.contextWindow > 0 ? Math.round((agent.context / agent.contextWindow) * 100) : 0;
        return (
          <li key={agent.agentId}>
            <span className="font-medium">{agent.description}</span>
            <span className="opacity-80">
              {" "}
              · {shortModel(agent.model)} · {percent}% context
            </span>
            <br />
            <span className="font-mono opacity-80">
              {live.label} · {duration(now - live.since)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
