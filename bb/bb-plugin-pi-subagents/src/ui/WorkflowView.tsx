import { agentKey, type Agent, type Workflow } from "../contract";
import { AgentCard } from "./AgentCard";
import { ViewHeader } from "./ViewHeader";

type WorkflowViewProps = {
  workflow: Workflow;
  children: Agent[];
  now: number;
  onBack: () => void;
  onOpenAgent: (key: string) => void;
};

export function WorkflowView({ workflow, children, now, onBack, onOpenAgent }: WorkflowViewProps) {
  const inStartOrder = [...children].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  return (
    <>
      <ViewHeader title={workflow.name} onBack={onBack} />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-16 text-xs">
        {workflow.description ? <p>{workflow.description}</p> : null}
        {workflow.phases.length > 0 ? <p className="text-muted-foreground">{workflow.phases.join(" · ")}</p> : null}
        {inStartOrder.length === 0 ? <p className="text-muted-foreground">No agents started yet.</p> : null}
        {inStartOrder.map((agent) => (
          <AgentCard key={agentKey(agent)} agent={agent} now={now} onViewTranscript={() => onOpenAgent(agentKey(agent))} />
        ))}
      </div>
    </>
  );
}
