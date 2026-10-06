import { useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Subagent } from "../contract";
import { useNow, useTranscript } from "./data";
import { activityCounts, elapsedMs, formatDuration, isRunning, shortId } from "./format";
import { StatusGlyph } from "./glyphs";
import { Transcript } from "./Transcript";

async function copyAgentId(agentId: string) {
  try {
    await navigator.clipboard.writeText(agentId);
    toast.success("Copied agent id");
  } catch {
    toast.error("Couldn't copy agent id");
  }
}

function AgentIdChip({ agentId }: { agentId: string }) {
  return (
    <Tooltip delayDuration={350} disableHoverableContent>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Copy agent id ${agentId}`}
          onClick={() => void copyAgentId(agentId)}
          className="relative z-10 inline-flex h-5 shrink-0 items-center gap-1 rounded px-1 font-mono text-[11px] text-subtle-foreground outline-none hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {shortId(agentId)}
          <Icon name="Copy" aria-hidden className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="font-mono">{agentId}</span> — matches bb's get_subagent_result rows
      </TooltipContent>
    </Tooltip>
  );
}

function Elapsed({ agent }: { agent: Subagent }) {
  const now = useNow(isRunning(agent));
  const ms = elapsedMs(agent, now);
  if (ms === null) return null;
  return <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(ms)}</span>;
}

export function AgentCard({ threadId, agent }: { threadId: string; agent: Subagent }) {
  const [expanded, setExpanded] = useState(false);
  const running = isRunning(agent);
  const version = `${agent.status}|${agent.updatedAt}|${agent.turns}|${agent.toolCalls}`;
  const { transcript, error } = useTranscript(threadId, agent.callId, expanded, running, version);
  const toggle = () => setExpanded(!expanded);

  return (
    <article
      aria-label={agent.description}
      className={cn("rounded-lg border border-border bg-card text-card-foreground", running && "border-foreground/15")}
    >
      <div className="relative flex gap-2.5 px-3 py-2.5">
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={toggle}
          className="absolute inset-0 rounded-lg outline-none hover:bg-state-hover/50"
        />
        <span className="pointer-events-none relative mt-0.5">
          <StatusGlyph status={agent.status} />
        </span>
        <div className="pointer-events-none relative min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold">{agent.description}</span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">{agent.type}</span>
            {agent.background ? null : <span className="shrink-0 text-[11px] text-subtle-foreground">foreground</span>}
            <span className="flex-1" />
            <Elapsed agent={agent} />
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {agent.model ? <span className="min-w-0 truncate">{agent.model}</span> : null}
            {agent.model ? <span aria-hidden>·</span> : null}
            <span className="shrink-0">{activityCounts(agent)}</span>
            {agent.agentId ? (
              <span className="pointer-events-auto">
                <AgentIdChip agentId={agent.agentId} />
              </span>
            ) : null}
          </div>
          {agent.lastActivity ? (
            <div className={cn("truncate font-mono text-xs", running ? "text-foreground/75" : "text-subtle-foreground")} title={agent.lastActivity}>
              {agent.lastActivity}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} transcript of ${agent.description}`}
          onClick={toggle}
          className="relative z-10 inline-flex size-6 shrink-0 items-center justify-center self-start rounded-md text-subtle-foreground outline-none hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="ChevronDown" aria-hidden className={cn("size-3.5 transition-transform duration-150", expanded && "rotate-180")} />
        </button>
      </div>
      {expanded ? (
        <div className="border-t border-border px-3 py-2.5">
          <Transcript
            agent={agent}
            state={transcript}
            error={error}
            renderChild={(child) => <AgentCard key={child.callId} threadId={threadId} agent={child} />}
          />
        </div>
      ) : null}
    </article>
  );
}
