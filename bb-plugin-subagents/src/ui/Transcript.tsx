import { useRef, useState, type ReactNode } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Subagent, TranscriptEntry } from "../contract";
import { useStickToBottom, type TranscriptState } from "./data";
import { finalTextIndex, isRunning, orderSubagents } from "./format";

const PRE =
  "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground/90";

function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group/disclosure flex w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name="ChevronRight" aria-hidden className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-90")} />
        {summary}
      </button>
      {open ? <div className="mt-1 pl-[18px]">{children}</div> : null}
    </div>
  );
}

function PromptEntry({ text }: { text: string }) {
  return (
    <Disclosure summary={<span className="min-w-0 flex-1 truncate">Prompt — {text.split("\n")[0]}</span>}>
      <pre className={PRE}>{text}</pre>
    </Disclosure>
  );
}

function ToolEntry({ entry }: { entry: Extract<TranscriptEntry, { kind: "tool" }> }) {
  return (
    <Disclosure
      summary={
        <span className="flex min-w-0 flex-1 items-baseline gap-2 font-mono">
          <span className={cn("shrink-0 font-medium", entry.isError ? "text-destructive" : "text-foreground/80")}>{entry.name}</span>
          <span className="min-w-0 truncate">{entry.summary}</span>
          {entry.result === null ? <span className="shrink-0 font-sans text-subtle-foreground">running…</span> : null}
        </span>
      }
    >
      <div className="space-y-1.5">
        <pre className={PRE} aria-label={`${entry.name} arguments`}>
          {entry.args}
        </pre>
        {entry.result === null ? null : (
          <pre className={cn(PRE, entry.isError && "text-destructive")} aria-label={`${entry.name} result`}>
            {entry.result || "(empty result)"}
          </pre>
        )}
      </div>
    </Disclosure>
  );
}

function FinalResult({ text, failed }: { text: string; failed: boolean }) {
  return (
    <div
      className={cn("rounded-md border px-3 py-2", failed ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40")}
      aria-label="Final result"
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon
          name={failed ? "CircleX" : "CircleCheck"}
          aria-hidden
          className={cn("size-3.5", failed ? "text-destructive" : "text-success-foreground")}
        />
        {failed ? "Error" : "Result"}
      </div>
      <Markdown content={text} className="text-sm" />
    </div>
  );
}

export function Transcript({
  agent,
  state,
  error,
  renderChild,
}: {
  agent: Subagent;
  state: TranscriptState | null;
  error: string | null;
  renderChild: (child: Subagent) => ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const entries = state?.entries ?? [];
  const last = entries.at(-1);
  useStickToBottom(scroller, isRunning(agent), `${entries.length}:${last?.kind === "tool" && last.result !== null}`);
  const failed = agent.status === "failed";
  const finalIndex = finalTextIndex(entries, agent.result);
  const showResult = agent.result !== null && !isRunning(agent) && finalIndex === -1;

  return (
    <div ref={scroller} className="max-h-[32rem] overflow-y-auto overscroll-contain">
      <div className="space-y-1.5 pb-1">
        {error !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {state === null && error === null ? <p className="text-xs text-muted-foreground">Loading transcript…</p> : null}
        {state?.truncated ? <p className="text-xs text-subtle-foreground">Earlier entries omitted.</p> : null}
        {state !== null && entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {agent.outputFile === null ? "No transcript was recorded for this subagent." : "Nothing in the transcript yet."}
          </p>
        ) : null}
        {entries.map((entry, index) => {
          switch (entry.kind) {
            case "prompt":
              return <PromptEntry key={index} text={entry.text} />;
            case "tool":
              return <ToolEntry key={entry.callId ?? index} entry={entry} />;
            case "text":
              return index === finalIndex ? (
                <FinalResult key={index} text={entry.text} failed={failed} />
              ) : (
                <Markdown key={index} content={entry.text} className="text-sm" />
              );
          }
        })}
        {showResult ? <FinalResult text={agent.result!} failed={failed} /> : null}
        {state !== null && state.children.length > 0 ? (
          <div className="space-y-1.5 border-l border-border pl-3">{orderSubagents(state.children).map(renderChild)}</div>
        ) : null}
      </div>
    </div>
  );
}
