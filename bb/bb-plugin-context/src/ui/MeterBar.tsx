import { cn } from "@/lib/utils";
import { Meter, type MeterSegment } from "../kit";
import type { Segment } from "../contract";
import { CATEGORY_FILL, formatTokens } from "./format";

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
  size?: "sm" | "lg";
  className?: string;
}) {
  const used = segments.filter((segment) => segment.id !== "reserved");
  const reserved = segments.find((segment) => segment.id === "reserved");
  const sum = segments.reduce((acc, segment) => acc + segment.tokens, 0);
  const denominator = total !== null && total > 0 ? total : Math.max(sum, 1);
  const fills: MeterSegment[] = used.map((segment) => ({ value: segment.tokens, className: CATEGORY_FILL[segment.id], label: segment.label }));
  if (reserved !== undefined) {
    fills.push({ value: Math.max(0, denominator - sum), className: "bg-transparent" });
    fills.push({ value: reserved.tokens, className: CATEGORY_FILL.reserved, label: reserved.label });
  }
  const tick =
    autoCompactAt === null || total === null || autoCompactAt >= total
      ? undefined
      : { value: autoCompactAt, label: `Autocompact at ${formatTokens(autoCompactAt)}` };
  return (
    // The numbers are always spelled out beside the bar; the spacer before the reserved buffer would make the progressbar's value wrong.
    <div aria-hidden="true" className={className}>
      <Meter
        segments={fills}
        max={denominator}
        tick={tick}
        label="Context used"
        size={size}
        className={cn(total === null && "opacity-50")}
      />
    </div>
  );
}
