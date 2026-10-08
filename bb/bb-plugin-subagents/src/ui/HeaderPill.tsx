import { useBbNavigate, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useThreadTally } from "./data";
import { pillLabel, pillText } from "./format";
import { RunningGlyph } from "./glyphs";

export const PANEL_ACTION_ID = "subagents";

export function HeaderPill({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const counts = useThreadTally(threadId);
  const navigate = useBbNavigate();
  if (counts === null || counts.total === 0) return null;
  const running = counts.running > 0;
  const label = pillLabel(counts);

  return (
    <TooltipProvider>
      <Tooltip delayDuration={350} disableHoverableContent>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={() => navigate.openThreadPanel({ actionId: PANEL_ACTION_ID })}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs tabular-nums outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring",
              running ? "text-foreground/80" : "text-muted-foreground",
            )}
          >
            {running ? <RunningGlyph className="size-3.5" /> : <Icon name="Bot" aria-hidden className="size-3.5" />}
            <span className="whitespace-nowrap">
              {isCompactViewport ? (running ? counts.running : counts.total) : pillText(counts)}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{running ? "Subagents running — open the Subagents panel" : "Open the Subagents panel"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
