import type { Agent } from "../contract";
import { Card, CardLine, CardTitle, LinkButton, StatusWord } from "./Card";
import { elapsed, kTokens, shortModel } from "./format";
import { liveLabel } from "./live";

function toolUses(agent: Agent): number {
  return agent.steps.filter((step) => step.kind === "tool").length;
}

type AgentCardProps = { agent: Agent; now: number; onViewTranscript: () => void };

export function AgentCard({ agent, now, onViewTranscript }: AgentCardProps) {
  const uses = toolUses(agent);
  return (
    <Card label={agent.description}>
      <CardTitle>{agent.description}</CardTitle>
      <CardLine>
        <span>{agent.agentType}</span>
        <StatusWord status={agent.status} />
        <span>{elapsed(agent.startedAt, agent.endedAt, now)}</span>
      </CardLine>
      <CardLine>
        <span>{shortModel(agent.model)}</span>
        {agent.totalTokens !== null ? <span>{kTokens(agent.totalTokens)} tokens</span> : null}
        <span>{uses === 1 ? "1 tool use" : `${uses} tool uses`}</span>
        <LinkButton onClick={onViewTranscript}>View transcript</LinkButton>
      </CardLine>
      {agent.status === "running" ? (
        <CardLine>
          <span className="truncate font-mono">{liveLabel(agent, now)}</span>
        </CardLine>
      ) : null}
    </Card>
  );
}
