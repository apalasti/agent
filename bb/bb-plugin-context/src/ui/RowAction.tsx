import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** A whole kit-style row that is itself the control (disclosure, jump-to-turn). */
export const RowAction = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof Button>>(({ className, ...props }, ref) => (
  <Button
    ref={ref}
    type="button"
    variant="ghost"
    className={cn(
      "flex h-7 w-full min-w-0 justify-start gap-2 rounded-none px-3 text-left text-sm font-normal text-foreground focus-visible:ring-inset [&_[data-icon-root]]:size-3.5",
      className,
    )}
    {...props}
  />
));
RowAction.displayName = "RowAction";

/** The `…` trigger of a row menu, always visible; the kit's RowMoreMenu has no per-item actions. */
export const RowMenuTrigger = forwardRef<HTMLButtonElement, Omit<ComponentPropsWithoutRef<typeof Button>, "children"> & { label: string }>(
  ({ label, className, ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      className={cn(
        "size-6.5 shrink-0 text-subtle-foreground group-hover/row:text-foreground group-focus-within/row:text-foreground [&_[data-icon-root]]:size-3.5",
        className,
      )}
      {...props}
    >
      <Icon name="MoreHorizontal" aria-hidden />
    </Button>
  ),
);
RowMenuTrigger.displayName = "RowMenuTrigger";
