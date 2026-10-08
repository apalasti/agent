import { useState } from "react";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import type { Agent, ThreadAgents } from "../contract";
import { AgentDetail } from "./AgentDetail";
import { AgentRow } from "./AgentRow";
import { ContextBar } from "./ContextBar";
import { shortModel } from "./format";
import { useNow, useThreadAgents } from "./useThreadAgents";

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
      ) : data.agents.length === 0 ? (
        <p role="status" className="p-3 text-sm text-muted-foreground">
          No Claude Code subagents in this thread.
        </p>
      ) : (
        <AgentList data={data} />
      )}
    </div>
  );
}

function AgentList({ data }: { data: ThreadAgents }) {
  const running = data.agents.filter((agent) => agent.status === "running");
  const finished = data.agents.filter((agent) => agent.status !== "running").reverse();
  const ordered = [...running, ...finished];
  const now = useNow(running.length > 0);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = ordered.find((agent) => agent.agentId === openId) ?? null;

  return (
    <>
      <PanelHeader data={data} running={running} finished={finished} />
      <div className={cn("overflow-y-auto", open ? "max-h-[45%] shrink-0" : "min-h-0 flex-1 pb-16")}>
        {ordered.map((agent) => (
          <AgentRow
            key={agent.agentId}
            agent={agent}
            data={data}
            now={now}
            isOpen={agent === open}
            onToggle={() => setOpenId(agent === open ? null : agent.agentId)}
          />
        ))}
      </div>
      {open ? <AgentDetail key={open.agentId} agent={open} now={now} /> : null}
    </>
  );
}

function PanelHeader({ data, running, finished }: { data: ThreadAgents; running: Agent[]; finished: Agent[] }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2 text-xs">
      <span className="font-medium">
        {running.length} running
        <span className="font-normal text-muted-foreground"> · {finished.length} finished</span>
      </span>
      <span className="flex-1" />
      {data.lead ? (
        <>
          <span className="text-muted-foreground">Lead</span>
          <span className="font-mono">{shortModel(data.lead.model)}</span>
          <ContextBar used={data.lead.context} window={data.lead.contextWindow} />
        </>
      ) : null}
    </div>
  );
}
