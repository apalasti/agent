import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type MenuEntry =
  | { kind: "item"; label: string; icon?: string; destructive?: boolean; disabled?: boolean; hint?: string; checked?: boolean; description?: string }
  | { kind: "separator" }
  | { kind: "label"; label: string };

/** The real vendored dropdown, opened from a trigger. */
export function RowMenu({ label, entries, children }: { label: string; entries: readonly MenuEntry[]; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" mobileTitle={label}>
        {entries.map((entry, index) => {
          if (entry.kind === "separator") return <DropdownMenuSeparator key={index} />;
          if (entry.kind === "label") return <DropdownMenuLabel key={index}>{entry.label}</DropdownMenuLabel>;
          return (
            <DropdownMenuItem
              key={entry.label}
              variant={entry.destructive ? "destructive" : "default"}
              disabled={entry.disabled}
              className={entry.hint || entry.description ? "items-start" : undefined}
            >
              {entry.icon ? <Icon name={entry.icon} aria-hidden className={entry.hint || entry.description ? "mt-px" : undefined} /> : null}
              <MenuText entry={entry} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuText({ entry }: { entry: Extract<MenuEntry, { kind: "item" }> }) {
  if (!entry.hint && !entry.description) return <>{entry.label}</>;
  return (
    <span className="flex min-w-0 flex-col">
      <span>{entry.label}</span>
      <span className="max-w-56 text-xs text-subtle-foreground">{entry.description ?? entry.hint}</span>
    </span>
  );
}

/** Hover hint for any control; replaces native `title`, which the vendored Button does not forward usefully. */
export function Hint({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="max-w-80">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
