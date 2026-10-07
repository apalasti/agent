import { useBbNavigate, useComposer } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import type { Meter } from "../contract";
import { useMeter } from "./data";
import { CATEGORY_STYLE, formatTokens, TONE_TEXT, toneFor, usableLimit, usageLabel, usedTotal } from "./format";
import { MeterBar } from "./MeterBar";

export const PANEL_ACTION_ID = "context";
export const PANEL_TITLE = "Context";

export function ComposerMeter() {
  const { scope } = useComposer();
  if (scope.kind !== "thread") return null;
  return <ThreadMeter threadId={scope.threadId} />;
}

function accessibleName(meter: Meter, used: number): string {
  const approx = meter.window.basis === "estimated" ? "about " : "";
  const of = meter.window.contextWindow === null ? "" : ` of ${formatTokens(meter.window.contextWindow)}`;
  return `Context: ${approx}${formatTokens(used)}${of} tokens used, open breakdown`;
}

function hoverTitle(meter: Meter): string {
  const lines = meter.segments.map((segment) => `${segment.label}: ${formatTokens(segment.tokens)}`);
  if (meter.window.autoCompactAt !== null) lines.push(`Autocompact at ${formatTokens(meter.window.autoCompactAt)}`);
  if (meter.window.basis === "estimated") lines.push("Total estimated by the Context plugin");
  return lines.join("\n");
}

function ThreadMeter({ threadId }: { threadId: string }) {
  const { meter } = useMeter(threadId);
  const navigate = useBbNavigate();
  if (meter === null || meter.window.basis === "none") return null;
  const used = usedTotal(meter.window, meter.segments);
  const tone = toneFor(used, usableLimit(meter.window));
  return (
    <button
      type="button"
      aria-label={accessibleName(meter, used)}
      title={hoverTitle(meter)}
      onClick={() => navigate.openThreadPanel({ actionId: PANEL_ACTION_ID, title: PANEL_TITLE })}
      className="group flex h-7 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MeterBar
        segments={meter.segments}
        total={meter.window.contextWindow}
        autoCompactAt={meter.window.autoCompactAt}
        className="w-28 min-w-6 shrink"
      />
      <span className={cn("shrink-0 whitespace-nowrap tabular-nums", TONE_TEXT[tone], tone === "muted" ? null : "font-medium")}>
        {usageLabel(meter.window, used)}
      </span>
      {meter.window.recomputing ? (
        <span className="shrink-0 whitespace-nowrap italic text-muted-foreground/80">recomputing</span>
      ) : null}
      <span className="flex h-4 min-w-0 flex-1 flex-wrap items-center overflow-hidden" data-top>
        {/* Holds the first line so a category that does not fit wraps out of sight instead of being clipped. */}
        <span className="h-4 w-0" />
        {meter.top.map((segment) => (
          <span key={segment.id} className="inline-flex h-4 shrink-0 items-center gap-1.5 whitespace-nowrap pr-3">
            <span className={cn("size-1.5 rounded-full", CATEGORY_STYLE[segment.id].dot)} />
            {CATEGORY_STYLE[segment.id].short} {formatTokens(segment.tokens)}
          </span>
        ))}
      </span>
    </button>
  );
}
