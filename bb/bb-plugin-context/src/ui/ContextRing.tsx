import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBbNavigate, useComposer } from "@get-bb/plugin-sdk/app";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type { Meter } from "../contract";
import { CourseChangeIcon, CourseChangeText } from "./CourseChangeRow";
import { useMeter, useReport } from "./data";
import { useFooterSlot } from "./footerSlot";
import { CATEGORY_STYLE, formatTokens, percent, TONE_TEXT, toneFor, usableLimit, usedTotal, type Tone } from "./format";
import { MeterBar } from "./MeterBar";

export const PANEL_ACTION_ID = "context";
export const PANEL_TITLE = "Context";

const RADIUS = 6.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const DASHES = 12;

export function ContextRing() {
  const { scope } = useComposer();
  if (scope.kind !== "thread") return null;
  return <ThreadRing threadId={scope.threadId} />;
}

function ThreadRing({ threadId }: { threadId: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const slot = useFooterSlot(anchor);
  const { meter } = useMeter(threadId);
  const ring = meter === null || meter.window.basis === "none" ? null : <RingWithCard threadId={threadId} meter={meter} />;
  return (
    <span ref={anchor} className="contents">
      {slot === null ? ring : createPortal(ring, slot)}
    </span>
  );
}

function isApproximate(meter: Meter): boolean {
  return meter.window.basis === "estimated" || meter.window.recomputing;
}

function accessibleName(meter: Meter, used: number): string {
  const approx = isApproximate(meter) ? "about " : "";
  const share = percent(used, meter.window.contextWindow);
  if (share === null || meter.window.contextWindow === null) return `Context: ${approx}${formatTokens(used)} tokens used`;
  return `Context: ${approx}${share} used, ${formatTokens(used)} of ${formatTokens(meter.window.contextWindow)} tokens`;
}

function RingWithCard({ threadId, meter }: { threadId: string; meter: Meter }) {
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  const used = usedTotal(meter.window, meter.segments);
  const tone = toneFor(used, usableLimit(meter.window));
  const openPanel = () => {
    setOpen(false);
    navigate.openThreadPanel({ actionId: PANEL_ACTION_ID, title: PANEL_TITLE });
  };
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={accessibleName(meter, used)}
          onClick={openPanel}
          className="select-none -my-1 -mr-1 inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full pl-2 pr-2 transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:my-0 max-md:-mr-3 max-md:-ml-1 max-md:h-11 max-md:pr-3.5"
        >
          <span aria-hidden="true" className={cn("text-xs tabular-nums", TONE_TEXT[tone])}>
            {isApproximate(meter) ? "≈" : ""}
            {percent(used, meter.window.contextWindow) ?? formatTokens(used)}
          </span>
          <RingGlyph fraction={meter.window.contextWindow ? used / meter.window.contextWindow : 0} tone={tone} dashed={isApproximate(meter)} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-80 max-w-[calc(100vw-1rem)]">
        <Card threadId={threadId} meter={meter} used={used} tone={tone} onShowDetails={openPanel} />
      </HoverCardContent>
    </HoverCard>
  );
}

function RingGlyph({ fraction, tone, dashed }: { fraction: number; tone: Tone; dashed: boolean }) {
  const maskId = useId();
  const clamped = Math.min(1, Math.max(0, fraction));
  const dash = CIRCUMFERENCE / DASHES;
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4", TONE_TEXT[tone])} aria-hidden="true" data-dashed={dashed || undefined}>
      {dashed ? (
        <mask id={maskId}>
          <circle cx="8" cy="8" r={RADIUS} fill="none" stroke="white" strokeWidth="3" strokeDasharray={`${dash * 0.6} ${dash * 0.4}`} />
        </mask>
      ) : null}
      <g mask={dashed ? `url(#${maskId})` : undefined}>
        <circle cx="8" cy="8" r={RADIUS} fill="none" strokeWidth="3" className="stroke-border-hairline" />
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped)}
          transform="rotate(-90 8 8)"
        />
      </g>
    </svg>
  );
}

function Card({
  threadId,
  meter,
  used,
  tone,
  onShowDetails,
}: {
  threadId: string;
  meter: Meter;
  used: number;
  tone: Tone;
  onShowDetails: () => void;
}) {
  const { contextWindow, autoCompactAt, recomputing } = meter.window;
  const share = percent(used, contextWindow);
  const categories = meter.segments.filter((segment) => segment.id !== "reserved").sort((a, b) => b.tokens - a.tokens);
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex items-baseline justify-between gap-2 tabular-nums text-muted-foreground" data-headline>
        <span className="min-w-0">
          <span className={cn("font-medium", tone === "muted" ? "text-foreground" : TONE_TEXT[tone])}>
            {isApproximate(meter) ? "≈" : ""}
            {formatTokens(used)}
          </span>
          {contextWindow === null ? " tokens" : ` / ${formatTokens(contextWindow)} tokens`}
          {share === null ? null : ` · ${share}`}
          {recomputing ? <span className="ml-1.5 italic text-muted-foreground/80">recomputing</span> : null}
        </span>
        {autoCompactAt === null ? null : <span className="shrink-0">autocompact at {formatTokens(autoCompactAt)}</span>}
      </div>
      <MeterBar segments={meter.segments} total={contextWindow} autoCompactAt={autoCompactAt} />
      <ul aria-label="Used context" className="flex flex-col gap-0.5">
        {categories.map((segment) => (
          <li key={segment.id} className="flex items-center gap-2">
            <span className={cn("size-2 shrink-0 rounded-full", CATEGORY_STYLE[segment.id].dot)} />
            <span className="min-w-0 flex-1 truncate">{segment.label}</span>
            <span className="shrink-0 tabular-nums">{formatTokens(segment.tokens)}</span>
            <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">{percent(segment.tokens, used)}</span>
          </li>
        ))}
      </ul>
      <ReportDetails threadId={threadId} />
      <button
        type="button"
        onClick={onShowDetails}
        className="-mx-1 -mb-1 rounded-md px-1 py-1 text-left font-medium text-foreground transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Show details
      </button>
    </div>
  );
}

function ReportDetails({ threadId }: { threadId: string }) {
  const { report, error } = useReport(threadId);
  if (report === null) {
    return <p className="border-t pt-2 text-muted-foreground">{error === null ? "Loading largest items…" : "Couldn't load the breakdown"}</p>;
  }
  const lastChange = report.courseChanges[report.courseChanges.length - 1];
  const largest = report.largest.slice(0, 3);
  if (largest.length === 0 && lastChange === undefined) return null;
  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      {largest.length === 0 ? null : (
        <ul aria-label="Largest items" className="flex flex-col gap-0.5">
          {largest.map((item) => (
            <li key={`${item.categoryId}-${item.id}`} className="flex min-w-0 items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", CATEGORY_STYLE[item.categoryId].dot)} />
              <span className="max-w-[45%] shrink-0 truncate" title={item.label}>
                {item.label}
              </span>
              {item.detail === null ? null : (
                <span title={item.detail} className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                  {item.detail}
                </span>
              )}
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {item.turnIndex === null ? "" : `#${item.turnIndex}`}
              </span>
              <span className="w-9 shrink-0 text-right tabular-nums">{formatTokens(item.tokens)}</span>
            </li>
          ))}
        </ul>
      )}
      {lastChange === undefined ? null : (
        <p data-course-change={lastChange.kind} className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <CourseChangeIcon kind={lastChange.kind} className="size-3.5 shrink-0" />
          <span className="flex min-w-0 items-center gap-1 truncate whitespace-nowrap">
            <CourseChangeText change={lastChange} />
          </span>
        </p>
      )}
    </div>
  );
}
