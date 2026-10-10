import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type Status = "running" | "ready" | "done" | "warning" | "failed" | "idle";

export const STATUS: Record<Status, { glyph: string | null; tone: string; dot: string }> = {
  running: { glyph: "Loading", tone: "text-muted-foreground", dot: "bg-file-accent" },
  ready: { glyph: "Circle", tone: "text-success-foreground", dot: "bg-success" },
  done: { glyph: "CircleCheck", tone: "text-muted-foreground", dot: "bg-subtle-foreground" },
  warning: { glyph: "AlertTriangle", tone: "text-warning-text", dot: "bg-warning" },
  failed: { glyph: "CircleX", tone: "text-destructive-text", dot: "bg-destructive" },
  idle: { glyph: "CircleQuestion", tone: "text-subtle-foreground", dot: "border border-subtle-foreground" },
};

export function Spinner({ className }: { className?: string }) {
  return <Icon name="Loading" aria-hidden className={cn("size-3.5 shrink-0 animate-spin motion-reduce:animate-none", className)} />;
}

export function StatusGlyph({ status, className }: { status: Status; className?: string }) {
  const { glyph, tone } = STATUS[status];
  if (status === "running") return <Spinner className={cn(tone, className)} />;
  if (glyph === null) return null;
  return <Icon name={glyph} aria-hidden className={cn("size-3.5 shrink-0", tone, className)} />;
}

export function StatusDot({ status, label, className }: { status: Status; label?: string; className?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("size-1.5 shrink-0 rounded-full", STATUS[status].dot, className)}
    />
  );
}

export function StatusWord({ status, children, glyph = true }: { status: Status; children: ReactNode; glyph?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1", STATUS[status].tone)}>
      {glyph ? <StatusGlyph status={status} /> : null}
      {children}
    </span>
  );
}
