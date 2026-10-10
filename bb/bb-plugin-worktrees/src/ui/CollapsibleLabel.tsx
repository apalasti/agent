import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chevron } from "../kit";

/** A SectionLabel that toggles the group under it. */
export function CollapsibleLabel({
  children,
  aside,
  open,
  onToggle,
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "flex h-auto w-full items-baseline justify-start gap-1 rounded-none px-3 pb-1 pt-3 text-2xs font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground",
        className,
      )}
    >
      <Chevron open={open} className="size-3 self-center" />
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {aside === undefined || aside === null ? null : (
        <span className="shrink-0 text-2xs font-normal tabular-nums text-subtle-foreground">{aside}</span>
      )}
    </Button>
  );
}
