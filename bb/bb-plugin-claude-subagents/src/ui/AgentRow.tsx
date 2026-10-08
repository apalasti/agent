import type { ReactNode } from "react";
import { experimental_FileLink as FileLink, useComposer } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Agent, FileChange, ThreadAgents } from "../contract";
import { ContextBar } from "./ContextBar";
import { firstLine } from "../text";
import { duration, kTokens, relPath, shortModel, workspacePath } from "./format";
import { liveState, QUIET_WARN_MS } from "./live";
import { StatusBadge } from "./StatusBadge";

type AgentRowProps = { agent: Agent; data: ThreadAgents; now: number; isOpen: boolean; onToggle: () => void };

export function AgentRow({ agent, data, now, isOpen, onToggle }: AgentRowProps) {
  const tools = agent.steps.filter((step) => step.kind === "tool").length;
  return (
    <article aria-label={agent.description} className={cn("border-b border-border px-3 py-2 text-xs", isOpen && "bg-state-hover/60")}>
      <div className="flex items-center gap-2">
        <StatusBadge status={agent.status} />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="min-w-0 truncate text-left font-medium hover:underline"
          title="Show brief, steps and report"
        >
          {agent.description}
        </button>
        <span className="shrink-0 font-mono text-muted-foreground">{shortModel(agent.model)}</span>
        <span className="flex-1" />
        <ContextBar used={agent.context} window={agent.contextWindow} warn={agent.status === "running"} />
        <span className="w-14 shrink-0 text-right text-muted-foreground tabular-nums">
          {agent.startedAt === null ? "–" : duration((agent.endedAt ?? now) - agent.startedAt)}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-1.5 pl-5">
        {agent.status === "running" ? <LiveLine agent={agent} now={now} /> : <Outcome report={agent.report} />}
      </div>

      {agent.files.length > 0 || agent.errors > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5">
          {agent.errors > 0 ? <span className="text-destructive">{agent.errors} failed calls</span> : null}
          {agent.files.map((file) => (
            <FileChangeLink key={file.path} file={file} data={data} />
          ))}
        </div>
      ) : null}

      <div className="mt-1.5 flex items-center gap-1 pl-5 text-[11px]">
        <span className="text-muted-foreground tabular-nums">
          {tools} tools{agent.totalTokens !== null ? ` · ${kTokens(agent.totalTokens)} tokens` : ""}
        </span>
        <span className="flex-1" />
        <AgentActions agent={agent} />
      </div>
    </article>
  );
}

function LiveLine({ agent, now }: { agent: Agent; now: number }) {
  const live = liveState(agent, now);
  const quiet = now - live.since;
  const tooQuiet = quiet > QUIET_WARN_MS;
  return (
    <>
      {live.inFlight ? <Icon name="Loading" aria-hidden className="size-3 shrink-0 animate-spin text-muted-foreground" /> : null}
      <span className={cn("min-w-0 flex-1 truncate font-mono", !live.inFlight && "italic text-muted-foreground")}>{live.label}</span>
      <span className={cn("shrink-0 tabular-nums", tooQuiet ? "font-medium text-warning-text" : "text-muted-foreground")}>
        {tooQuiet ? `quiet ${duration(quiet)}` : duration(quiet)}
      </span>
    </>
  );
}

function Outcome({ report }: { report: string | null }) {
  if (report === null) return <span className="flex-1 text-warning-text">No report handed back</span>;
  return <span className="min-w-0 flex-1 truncate text-muted-foreground">↳ {firstLine(report)}</span>;
}

function FileChangeLink({ file, data }: { file: FileChange; data: ThreadAgents }) {
  const inWorkspace = workspacePath(file.path, data.cwd);
  const target =
    data.environmentId && inWorkspace ? { kind: "workspace" as const, environmentId: data.environmentId, path: inWorkspace } : null;
  const label = relPath(file.path, data.cwd);
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {target ? (
        <FileLink target={target} className="truncate font-mono hover:underline">
          {label}
        </FileLink>
      ) : (
        <span className="truncate font-mono">{label}</span>
      )}
      <span className="text-diff-added tabular-nums">+{file.added}</span>
      <span className="text-diff-removed tabular-nums">−{file.removed}</span>
    </span>
  );
}

function AgentActions({ agent }: { agent: Agent }) {
  const composer = useComposer();
  const draft = (text: string) => composer.insert(text, { at: "end", block: true });
  const name = `"${agent.description}"`;
  if (agent.status === "running")
    return (
      <>
        <ActionButton onClick={() => draft(`Stop the subagent ${name} (task ${agent.agentId}) with TaskStop.`)}>Stop…</ActionButton>
        <ActionButton onClick={() => draft(`Send the running subagent ${name} (agent ${agent.agentId}) this message: `)}>Steer…</ActionButton>
      </>
    );
  return (
    <ActionButton onClick={() => draft(`Continue the subagent ${name} (agent ${agent.agentId}) with SendMessage: `)}>Follow up…</ActionButton>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Drafts the instruction in the composer; you send it"
      className="rounded border border-border px-1.5 py-0.5 hover:bg-state-hover"
    >
      {children}
    </button>
  );
}
