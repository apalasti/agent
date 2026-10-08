import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { SubagentStatus } from "../contract";
import { STATUS_LABEL } from "./format";

const GLYPH = "size-4 shrink-0";

export function RunningGlyph({ className, label }: { className?: string; label?: string }) {
  return (
    <Icon
      name="Loading"
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className={cn(GLYPH, "animate-spin text-muted-foreground motion-reduce:animate-none", className)}
    />
  );
}

const STATIC: Record<Exclude<SubagentStatus, "running">, { icon: string; tone: string }> = {
  completed: { icon: "CircleCheck", tone: "text-success-foreground" },
  failed: { icon: "CircleX", tone: "text-destructive" },
  stopped: { icon: "Square", tone: "text-muted-foreground" },
  unknown: { icon: "CircleQuestion", tone: "text-muted-foreground/75" },
};

export function StatusGlyph({ status }: { status: SubagentStatus }) {
  if (status === "running") return <RunningGlyph label={STATUS_LABEL.running} />;
  const { icon, tone } = STATIC[status];
  return <Icon name={icon} aria-label={STATUS_LABEL[status]} className={cn(GLYPH, tone)} />;
}
