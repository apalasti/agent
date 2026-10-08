import { useBbNavigate, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Agent, AgentStatus, ThreadAgents, Workflow } from "../contract";
import { shortModel } from "./format";
import { liveLabel } from "./live";
import { useNow, useThreadAgents } from "./useThreadAgents";

export const PANEL_ACTION_ID = "pi-subagents";

export function HeaderPill({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { data } = useThreadAgents(threadId);
  const navigate = useBbNavigate();
  const { agents, workflows, running, runningWorkflows } = summarize(data);
  const isRunning = running.length + runningWorkflows.length > 0;
  const now = useNow(isRunning);
  if (agents.length === 0 && workflows.length === 0) return null;

  const label = isRunning ? runningLabel(running, runningWorkflows) : idleSummary([...agents, ...workflows]).text;
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Subagents: ${label}`}
            onClick={() => navigate.openThreadPanel({ actionId: PANEL_ACTION_ID })}
            className="inline-flex h-7 max-w-80 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs tabular-nums hover:bg-state-hover"
          >
            {isRunning ? (
              <RunningContent label={label} newest={running[running.length - 1]} now={now} compact={isCompactViewport} />
            ) : (
              <IdleContent items={[...agents, ...workflows]} />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-96">
          {isRunning ? <RunningTooltip running={running} workflows={runningWorkflows} now={now} /> : "Open the subagents panel"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function summarize(data: ThreadAgents | null) {
  const agents = (data?.agents ?? []).filter((agent) => agent.workflowId === null);
  const workflows = data?.workflows ?? [];
  return {
    agents,
    workflows,
    running: agents.filter((agent) => agent.status === "running"),
    runningWorkflows: workflows.filter((workflow) => workflow.status === "running"),
  };
}

function runningLabel(running: Agent[], workflows: Workflow[]): string {
  const workflowCount = workflows.length === 1 ? "1 workflow" : `${workflows.length} workflows`;
  if (running.length > 0) return workflows.length > 0 ? `${running.length} running · ${workflowCount}` : `${running.length} running`;
  return workflows.length === 1 ? `Workflow: ${workflows[0]!.name}` : `${workflowCount} running`;
}

function idleSummary(items: { status: AgentStatus }[]): { text: string; icon: string; tone: string } {
  const needLook = items.filter((item) => item.status === "failed" || item.status === "needs-look").length;
  if (needLook > 0) return { text: `${needLook} need a look`, icon: "AlertTriangle", tone: "text-warning-text" };
  const done = items.filter((item) => item.status === "done").length;
  if (done > 0) return { text: `${done} done`, icon: "CircleCheck", tone: "text-success" };
  return { text: `${items.length} unknown`, icon: "CircleQuestion", tone: "text-muted-foreground" };
}

function IdleContent({ items }: { items: { status: AgentStatus }[] }) {
  const { text, icon, tone } = idleSummary(items);
  return (
    <>
      <Icon name={icon} aria-hidden className={cn("size-3.5 shrink-0", tone)} />
      <span className={cn("shrink-0 font-medium", tone)}>{text}</span>
    </>
  );
}

type RunningContentProps = { label: string; newest: Agent | undefined; now: number; compact: boolean };

function RunningContent({ label, newest, now, compact }: RunningContentProps) {
  return (
    <>
      <Icon name="Loading" aria-hidden className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
      <span className="min-w-0 shrink-0 truncate font-medium">{label}</span>
      {compact || !newest ? null : <span className="min-w-0 truncate font-mono text-muted-foreground">{liveLabel(newest, now)}</span>}
    </>
  );
}

function RunningTooltip({ running, workflows, now }: { running: Agent[]; workflows: Workflow[]; now: number }) {
  return (
    <ul className="space-y-1 text-xs">
      {workflows.map((workflow) => (
        <li key={workflow.runId}>
          <span className="font-medium">{workflow.name}</span>
          <span className="opacity-80"> · workflow · {workflow.done + workflow.failed} agents finished</span>
        </li>
      ))}
      {running.map((agent) => {
        const percent = agent.contextWindow > 0 ? Math.round((agent.context / agent.contextWindow) * 100) : 0;
        return (
          <li key={agent.agentId}>
            <span className="font-medium">{agent.description}</span>
            <span className="opacity-80">
              {" "}
              · {shortModel(agent.model)} · {percent}% context
            </span>
            <br />
            <span className="font-mono opacity-80">{liveLabel(agent, now)}</span>
          </li>
        );
      })}
    </ul>
  );
}
