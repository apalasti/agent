import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "../contract";

const BADGES: Record<AgentStatus, { icon: string; word: string; tone: string }> = {
  running: { icon: "Loading", word: "Running", tone: "text-muted-foreground" },
  done: { icon: "CircleCheck", word: "Done", tone: "text-success-foreground" },
  "needs-look": { icon: "AlertTriangle", word: "No report", tone: "text-warning-text" },
  failed: { icon: "CircleX", word: "Failed", tone: "text-destructive" },
  unknown: { icon: "CircleQuestion", word: "Unknown", tone: "text-muted-foreground/75" },
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  const { icon, word, tone } = BADGES[status];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 font-medium", tone)}>
      <Icon
        name={icon}
        aria-hidden
        className={cn("size-3.5 shrink-0", status === "running" && "animate-spin motion-reduce:animate-none")}
      />
      <span>{word}</span>
    </span>
  );
}
