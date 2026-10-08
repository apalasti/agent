import type { ThreadAgents } from "../contract";
import { AgentCard } from "./AgentCard";
import type { View } from "./SubagentsPanel";
import { WorkflowCard } from "./WorkflowCard";

const runningFirstThenNewest = <T extends { status: string; startedAt: number | null }>(items: T[]): T[] =>
  [...items].sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || (b.startedAt ?? 0) - (a.startedAt ?? 0));

export function CardList({ data, now, onOpen }: { data: ThreadAgents; now: number; onOpen: (view: View) => void }) {
  const workflows = runningFirstThenNewest(data.workflows);
  const agents = runningFirstThenNewest(data.agents.filter((agent) => agent.workflowId === null));
  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pb-16">
      {workflows.map((workflow) => (
        <WorkflowCard
          key={workflow.runId}
          workflow={workflow}
          children={data.agents.filter((agent) => agent.workflowId === workflow.runId)}
          now={now}
          onViewAgents={() => onOpen({ kind: "workflow", runId: workflow.runId })}
        />
      ))}
      {agents.map((agent) => (
        <AgentCard
          key={agent.agentId}
          agent={agent}
          now={now}
          onViewTranscript={() => onOpen({ kind: "agent", agentId: agent.agentId, from: { kind: "list" } })}
        />
      ))}
    </div>
  );
}
