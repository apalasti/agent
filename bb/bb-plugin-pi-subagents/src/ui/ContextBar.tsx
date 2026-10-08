import { cn } from "@/lib/utils";
import { kTokens } from "./format";
import { contextTone } from "./live";

const FILL = { ok: "bg-foreground/50", warn: "bg-amber-500", critical: "bg-destructive" } as const;
const TEXT = { ok: "text-muted-foreground", warn: "text-warning-text", critical: "text-destructive" } as const;

export function ContextBar({ used, window, warn = true, className }: { used: number; window: number; warn?: boolean; className?: string }) {
  const tone = warn ? contextTone(used, window) : "ok";
  const percent = window > 0 ? Math.min(100, (used / window) * 100) : 0;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 tabular-nums", className)}
      title={`${used.toLocaleString()} of ${window.toLocaleString()} tokens in context`}
    >
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", FILL[tone])} style={{ width: `${Math.max(2, percent)}%` }} />
      </span>
      <span className={TEXT[tone]}>
        {kTokens(used)}/{kTokens(window)}
      </span>
    </span>
  );
}
