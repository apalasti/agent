import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Markdown, useComposer } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Agent, Step } from "../contract";
import { activitySummary } from "./activity";
import { Spinner } from "./Card";
import { clock, duration, shortModel } from "./format";
import { liveLabel } from "./live";
import { ViewHeader } from "./ViewHeader";

const COPIED_MS = 1_500;

export function TranscriptView({ agent, now, onBack }: { agent: Agent; now: number; onBack: () => void }) {
  return (
    <>
      <ViewHeader title={agent.description} onBack={onBack} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-16 text-xs">
        <p className="flex gap-2">
          <span className="text-muted-foreground">Model</span>
          <span>{shortModel(agent.model)}</span>
        </p>
        <PromptCard prompt={agent.prompt} />
        <ActivitySummary steps={agent.steps} running={agent.status === "running"} now={now} />
        <Outcome agent={agent} now={now} />
        {agent.workflowId === null ? <AgentActions agent={agent} /> : null}
      </div>
    </>
  );
}

function PromptCard({ prompt }: { prompt: string }) {
  const body = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [copied, setCopied] = useState(false);

  useLayoutEffect(() => {
    const el = body.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [prompt, expanded]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);

  const clamped = overflows && !expanded;
  return (
    <div>
      <div className="rounded-lg bg-muted/40 p-3">
        <div ref={body} className={cn("relative", !expanded && "max-h-60 overflow-hidden")}>
          <Markdown content={prompt} />
          {clamped ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted to-transparent" /> : null}
        </div>
        {overflows ? (
          <button type="button" onClick={() => setExpanded(!expanded)} className="mt-1 text-muted-foreground hover:text-foreground">
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Copy prompt"
        title="Copy prompt"
        onClick={() => void navigator.clipboard.writeText(prompt).then(() => setCopied(true))}
        className="mt-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover"
      >
        <Icon name={copied ? "Check" : "Copy"} aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

function ActivitySummary({ steps, running, now }: { steps: Step[]; running: boolean; now: number }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  if (steps.length === 0) return null;
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex max-w-full items-center gap-1 text-left text-muted-foreground hover:text-foreground"
      >
        <span className="min-w-0 truncate">{activitySummary(steps) || "No tool calls"}</span>
        <Icon name="ChevronRight" aria-hidden className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div className="mt-1 font-mono text-[11px]">
          {steps.map((step, index) => (
            <StepLine
              key={index}
              step={step}
              inFlight={running && step.kind === "tool" && step.result === null}
              now={now}
              isSelected={selected === index}
              onToggle={() => setSelected(selected === index ? null : index)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

type StepLineProps = { step: Step; inFlight: boolean; now: number; isSelected: boolean; onToggle: () => void };

function StepLine({ step, inFlight, now, isSelected, onToggle }: StepLineProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isSelected}
        className={cn("flex w-full items-baseline gap-2 py-0.5 text-left hover:bg-state-hover", isSelected && "bg-state-hover")}
      >
        <span className="shrink-0 text-muted-foreground tabular-nums">{clock(step.at)}</span>
        <span className={cn("w-16 shrink-0 truncate", step.isError ? "text-destructive" : "text-muted-foreground")}>
          {step.kind === "text" ? "says" : step.name}
        </span>
        <span className={cn("min-w-0 flex-1 truncate", step.kind === "text" && "italic text-muted-foreground")}>{step.summary}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          <StepTiming step={step} inFlight={inFlight} now={now} />
        </span>
      </button>
      {isSelected ? (
        <div className="py-1 pl-24">
          <StepIO step={step} />
        </div>
      ) : null}
    </div>
  );
}

function StepTiming({ step, inFlight, now }: { step: Step; inFlight: boolean; now: number }) {
  if (inFlight)
    return (
      <span className="inline-flex items-center gap-1">
        <Spinner />
        {duration(now - step.at)}
      </span>
    );
  if (step.isError) return <span className="text-destructive">error</span>;
  if (step.kind === "tool" && step.endAt !== null) return <>{duration(step.endAt - step.at)}</>;
  return null;
}

function StepIO({ step }: { step: Step }) {
  return (
    <div className="space-y-1.5 text-[11px]">
      {step.input ? <pre className="max-h-48 overflow-auto rounded bg-muted/50 p-2 break-all whitespace-pre-wrap">{step.input}</pre> : null}
      {step.result !== null ? (
        <pre
          className={cn(
            "max-h-48 overflow-auto rounded p-2 break-all whitespace-pre-wrap",
            step.isError ? "bg-destructive/10 text-destructive" : "bg-muted/30 text-muted-foreground",
          )}
        >
          {step.result || "(empty)"}
        </pre>
      ) : step.kind === "tool" ? (
        <p className="text-muted-foreground">in flight…</p>
      ) : null}
    </div>
  );
}

function Outcome({ agent, now }: { agent: Agent; now: number }) {
  if (agent.status === "running")
    return (
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <Spinner />
        <span className="min-w-0 truncate font-mono">{liveLabel(agent, now)}</span>
      </p>
    );
  if (agent.report === null) return <p className="text-warning-text">No report handed back</p>;
  return <Markdown content={agent.report} className="text-sm" />;
}

function AgentActions({ agent }: { agent: Agent }) {
  const composer = useComposer();
  const draft = (text: string) => composer.insert(text, { at: "end", block: true });
  return (
    <div className="flex gap-1 pt-1">
      {agent.status === "running" ? (
        <ActionButton onClick={() => draft(`Use steer_subagent on agent \`${agent.agentId}\`: `)}>Steer…</ActionButton>
      ) : (
        <ActionButton onClick={() => draft(`Resume agent \`${agent.agentId}\` (Agent tool, resume) and `)}>Follow up…</ActionButton>
      )}
    </div>
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
