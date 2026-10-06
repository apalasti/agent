import type { PluginSidebarThreadIndicator, PluginSidebarThreadRowStatus } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Rollup } from "../group";

const GLYPH = "pointer-events-none size-4 shrink-0";
const WORKING = "animate-shine-icon text-muted-foreground/50";

const ACTIVITY_ICONS: Partial<Record<PluginSidebarThreadIndicator, string>> = {
  workflow: "Workflow",
  "background-agent": "UserRoundPlus",
  "background-command": "Terminal",
  "plan-mode": "ListTodo",
  goal: "Target",
};

const BUSY: ReadonlySet<PluginSidebarThreadIndicator> = new Set([
  "runtime",
  "workflow",
  "background-agent",
  "background-command",
  "plan-mode",
  "goal",
  "working-draft",
]);

/** bb draws the draft pencil in place of idle states, and a shimmering one while busy. */
export function withDraft(indicator: PluginSidebarThreadIndicator, hasDraft: boolean): PluginSidebarThreadIndicator {
  if (!hasDraft) return indicator;
  if (BUSY.has(indicator)) return "working-draft";
  return indicator === "none" || indicator === "unread-success" ? "draft" : indicator;
}

/** A plugin row status yields to the states bb never lets anything cover. */
export function rowStatusWins(indicator: PluginSidebarThreadIndicator, status: PluginSidebarThreadRowStatus | null) {
  return status !== null && indicator !== "runtime" && indicator !== "unread-error" && indicator !== "waiting-for-input";
}

export function UnreadDot({ label }: { label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      className="size-[5px] shrink-0 rounded-full bg-muted-foreground/60"
    />
  );
}

export function IndicatorGlyph({
  indicator,
  label,
}: {
  indicator: PluginSidebarThreadIndicator;
  label: string | null;
}) {
  const aria = label ?? undefined;
  switch (indicator) {
    case "unread-error":
    case "queued-failed":
      return <Icon name="CircleX" className={cn(GLYPH, "text-destructive")} aria-label={aria} />;
    case "waiting-for-input":
      return <Icon name="CircleQuestion" className={cn(GLYPH, "text-muted-foreground/75")} aria-label={aria} />;
    case "queued-waiting":
      return <Icon name="Clock" className={cn(GLYPH, "text-muted-foreground/75")} aria-label={aria} />;
    case "runtime":
      return (
        <Icon
          name="Loading"
          className={cn(GLYPH, "animate-spin text-muted-foreground/50 motion-reduce:animate-none")}
          aria-label={aria}
        />
      );
    case "working-draft":
      return <Icon name="Edit" className={cn(GLYPH, WORKING)} aria-label={aria ?? "Working, unsent draft"} />;
    case "draft":
      return <Icon name="Edit" className={cn(GLYPH, "text-muted-foreground")} aria-label={aria ?? "Unsent draft"} />;
    case "unread-success":
      return <UnreadDot label={aria ?? "Unread"} />;
    case "none":
      return null;
    default: {
      const icon = ACTIVITY_ICONS[indicator];
      return icon ? <Icon name={icon} className={cn(GLYPH, WORKING)} aria-label={aria} /> : null;
    }
  }
}

export function RowStatusGlyph({ status }: { status: PluginSidebarThreadRowStatus }) {
  const tone =
    status.tone === "running"
      ? "animate-shine-icon text-success"
      : status.tone === "success"
        ? "text-success-foreground"
        : status.tone === "error"
          ? "text-destructive"
          : "text-muted-foreground";
  return <Icon name={status.icon} className={cn(GLYPH, tone)} aria-label={status.label} />;
}

export function RunningStatusLine({ label }: { label: string }) {
  return (
    <span data-row-status-line="" className="pointer-events-none flex min-w-0 items-center gap-1 text-[11px] leading-4 text-subtle-foreground">
      <Icon name="Loading" className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

export function runningSummary(labels: readonly string[]): string | null {
  return labels.length > 0 ? labels.join(" · ") : null;
}

export function RunningRollupGlyph({ labels }: { labels: readonly string[] }) {
  const summary = runningSummary(labels);
  if (summary === null) return null;
  return <Icon name="Loading" className={cn(GLYPH, "size-3.5 animate-spin text-success motion-reduce:animate-none")} aria-label={summary} />;
}

const ROLLUP_LABEL: Record<Rollup, string | null> = {
  "unread-error": "A thread here failed",
  "waiting-for-input": "A thread here needs input",
  runtime: "A thread here is working",
  "unread-success": "Unread threads here",
  none: null,
};

export function RollupGlyph({ rollup }: { rollup: Rollup }) {
  return <IndicatorGlyph indicator={rollup} label={ROLLUP_LABEL[rollup]} />;
}
