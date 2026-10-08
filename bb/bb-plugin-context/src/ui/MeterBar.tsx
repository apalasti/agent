import { cn } from "@/lib/utils";
import type { Segment } from "../contract";
import { CATEGORY_STYLE, formatTokens } from "./format";

const SIZE = {
  sm: { track: "h-1.5", tick: "-top-0.5 h-2.5" },
  lg: { track: "h-3", tick: "-top-1 h-5" },
} as const;

function share(tokens: number, total: number): string {
  return `${Math.min(100, Math.max(0, (tokens / total) * 100))}%`;
}

/** Used segments fill from the left; the reserved buffer sits at the right end, where the window runs out. Without a known window the bar shows composition only, dimmed. */
export function MeterBar({
  segments,
  total,
  autoCompactAt,
  size = "sm",
  className,
}: {
  segments: readonly Segment[];
  total: number | null;
  autoCompactAt: number | null;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const used = segments.filter((segment) => segment.id !== "reserved");
  const reserved = segments.find((segment) => segment.id === "reserved");
  const sum = segments.reduce((acc, segment) => acc + segment.tokens, 0);
  const denominator = total !== null && total > 0 ? total : Math.max(sum, 1);
  const styles = SIZE[size];
  return (
    <div className={cn("relative", className)} aria-hidden="true">
      <div
        className={cn("relative flex w-full overflow-hidden rounded-full bg-muted", styles.track, total === null && "opacity-50")}
        data-window={total === null ? "unknown" : "known"}
      >
        {used.map((segment) => (
          <div
            key={segment.id}
            data-segment={segment.id}
            className={cn("h-full shrink-0 border-r border-background/60 last:border-r-0", CATEGORY_STYLE[segment.id].dot)}
            style={{ width: share(segment.tokens, denominator) }}
          />
        ))}
        {reserved === undefined ? null : (
          <div
            data-segment="reserved"
            className={cn("absolute inset-y-0 right-0 opacity-50", CATEGORY_STYLE.reserved.dot)}
            style={{ width: share(reserved.tokens, denominator) }}
          />
        )}
      </div>
      {autoCompactAt === null || total === null || autoCompactAt >= total ? null : (
        <div
          data-tick="autocompact"
          title={`Autocompact at ${formatTokens(autoCompactAt)}`}
          className={cn("absolute w-0.5 -translate-x-1/2 rounded-full bg-foreground/70", styles.tick)}
          style={{ left: share(autoCompactAt, total) }}
        />
      )}
    </div>
  );
}
