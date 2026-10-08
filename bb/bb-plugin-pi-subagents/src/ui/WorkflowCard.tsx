import type { Agent, Workflow } from "../contract";
import { Card, CardLine, CardTitle, LinkButton, StatusWord } from "./Card";
import { elapsed, kTokens } from "./format";

type WorkflowCardProps = { workflow: Workflow; children: Agent[]; now: number; onViewAgents: () => void };

export function WorkflowCard({ workflow, children, now, onViewAgents }: WorkflowCardProps) {
  const phases = workflow.phases.length;
  const finished = workflow.status !== "running";
  return (
    <Card label={workflow.name}>
      <CardTitle>{workflow.name}</CardTitle>
      <CardLine>
        <span>Workflow</span>
        <StatusWord status={workflow.status} />
        <span>{elapsed(workflow.startedAt, workflow.endedAt, now)}</span>
      </CardLine>
      <CardLine>
        {phases > 0 ? <span>{phases === 1 ? "1 phase" : `${phases} phases`}</span> : null}
        <span>
          {workflow.done + workflow.failed}/{children.length} agents
        </span>
        {finished && workflow.totalTokens !== null ? <span>{kTokens(workflow.totalTokens)} tokens</span> : null}
        <LinkButton onClick={onViewAgents}>View agents</LinkButton>
      </CardLine>
      {workflow.error ? <CardLine className="text-destructive">{workflow.error}</CardLine> : null}
    </Card>
  );
}
