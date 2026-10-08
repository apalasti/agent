import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "../contract";

export function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <article aria-label={label} className="space-y-0.5 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      {children}
    </article>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <p className="truncate text-sm text-foreground">{children}</p>;
}

export function CardLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums", className)}>{children}</p>;
}

export function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-file-accent hover:underline">
      {children}
    </button>
  );
}

const WORDS: Record<AgentStatus, { word: string; tone?: string }> = {
  running: { word: "Running" },
  done: { word: "Completed" },
  "needs-look": { word: "No report", tone: "text-warning-text" },
  failed: { word: "Failed", tone: "text-destructive" },
  unknown: { word: "Unknown" },
};

export function StatusWord({ status }: { status: AgentStatus }) {
  const { word, tone } = WORDS[status];
  return (
    <span className="inline-flex items-center gap-1">
      {status === "running" ? <Spinner /> : null}
      <span className={tone}>{word}</span>
    </span>
  );
}

export function Spinner() {
  return <Icon name="Loading" aria-hidden className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />;
}
