import { useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Agent, Step } from "../contract";
import { clock, duration } from "./format";

const PIN_THRESHOLD_PX = 24;

export function AgentDetail({ agent, now }: { agent: Agent; now: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [selected, setSelected] = useState<number | null>(null);
  const running = agent.status === "running";

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && running && pinned.current && selected === null) el.scrollTop = el.scrollHeight;
  }, [agent.steps.length, running, selected]);

  return (
    <section
      ref={scroller}
      aria-label={`Steps of ${agent.description}`}
      onScroll={(event) => {
        const el = event.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX;
      }}
      className="min-h-0 flex-1 overflow-y-auto border-t border-border px-3 pt-2 pb-16 font-mono text-[11px]"
    >
      <details className="mb-1 font-sans text-xs">
        <summary className="cursor-pointer text-muted-foreground">Brief</summary>
        <div className="max-h-60 overflow-y-auto rounded bg-muted/30 p-2">
          <Markdown content={agent.prompt} />
        </div>
      </details>
      {agent.steps.map((step, index) => (
        <StepLine
          key={index}
          step={step}
          inFlight={running && step.kind === "tool" && step.result === null}
          now={now}
          isSelected={selected === index}
          onToggle={() => setSelected(selected === index ? null : index)}
        />
      ))}
      {!running && agent.report ? (
        <div className="mt-2 rounded-md border border-border p-2 font-sans text-xs">
          <p className="mb-1 font-semibold">Report</p>
          <Markdown content={agent.report} />
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
        <Icon name="Loading" aria-hidden className="size-3 animate-spin" />
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
