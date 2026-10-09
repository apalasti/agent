import { useState } from "react";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { agentKey, type ThreadAgents } from "../contract";
import { CardList } from "./CardList";
import { TranscriptView } from "./TranscriptView";
import { useNow, useThreadAgents } from "./useThreadAgents";
import { WorkflowView } from "./WorkflowView";

export type View = { kind: "list" } | { kind: "workflow"; runId: string } | { kind: "agent"; key: string; from: View };

const LIST: View = { kind: "list" };

export function SubagentsPanel({ threadId }: PluginThreadPanelProps) {
  const { data, error } = useThreadAgents(threadId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? (
        <p role="alert" className="p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {data === null ? (
        error ? null : <p className="p-3 text-sm text-muted-foreground">Loading…</p>
      ) : data.agents.length === 0 && data.workflows.length === 0 ? (
        <p role="status" className="p-3 text-sm text-muted-foreground">
          No pi subagents or workflows in this thread.
        </p>
      ) : (
        <Views key={threadId} data={data} />
      )}
    </div>
  );
}

function Views({ data }: { data: ThreadAgents }) {
  const [view, setView] = useState<View>(LIST);
  const anyRunning = data.agents.some((agent) => agent.status === "running") || data.workflows.some((w) => w.status === "running");
  const now = useNow(anyRunning);

  if (view.kind === "agent") {
    const agent = data.agents.find((candidate) => agentKey(candidate) === view.key);
    if (agent) return <TranscriptView agent={agent} now={now} onBack={() => setView(view.from)} />;
  }
  if (view.kind === "workflow") {
    const workflow = data.workflows.find((candidate) => candidate.runId === view.runId);
    if (workflow)
      return (
        <WorkflowView
          workflow={workflow}
          children={data.agents.filter((agent) => agent.workflowId === workflow.runId)}
          now={now}
          onBack={() => setView(LIST)}
          onOpenAgent={(key) => setView({ kind: "agent", key, from: view })}
        />
      );
  }
  return <CardList data={data} now={now} onOpen={setView} />;
}
