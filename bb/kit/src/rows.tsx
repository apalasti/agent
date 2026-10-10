import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { type MenuEntry, RowMenu } from "./menus";

const REVEAL =
  "opacity-0 pointer-events-none group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-focus-within/row:opacity-100 group-focus-within/row:pointer-events-auto group-has-[[data-state=open]]/row:opacity-100 group-has-[[data-state=open]]/row:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto";
const HIDE_ON_REVEAL =
  "group-hover/row:opacity-0 group-focus-within/row:opacity-0 group-has-[[data-state=open]]/row:opacity-0 pointer-coarse:opacity-0";

export function Leading({ children }: { children?: ReactNode }) {
  return <span className="flex size-3.5 shrink-0 items-center justify-center">{children}</span>;
}

/** Meta sits in the trailing slot; hover or focus swaps it for the row's actions. */
export function Trailing({ meta, actions }: { meta?: ReactNode; actions?: ReactNode }) {
  if (!meta && !actions) return null;
  return (
    <span className="relative flex shrink-0 items-center justify-end self-stretch">
      {meta ? (
        <span className={cn("flex items-center gap-1.5 text-xs tabular-nums text-subtle-foreground", actions ? HIDE_ON_REVEAL : null)}>
          {meta}
        </span>
      ) : null}
      {actions ? (
        <span className={cn("absolute inset-y-0 right-0 flex items-center gap-0.5", REVEAL, !meta && "static")}>{actions}</span>
      ) : null}
    </span>
  );
}

export function Row({
  leading,
  children,
  meta,
  actions,
  onClick,
  selected,
  muted,
  className,
  title,
}: {
  leading?: ReactNode;
  children: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  muted?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      onClick={onClick}
      className={cn(
        "group/row relative flex h-7 min-w-0 items-center gap-2 px-3 text-sm hover:bg-state-hover",
        onClick && "cursor-pointer",
        selected && "bg-surface-selected hover:bg-surface-selected",
        muted ? "text-muted-foreground" : "text-foreground",
        className,
      )}
    >
      {leading === undefined ? null : <Leading>{leading}</Leading>}
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      <Trailing meta={meta} actions={actions} />
    </div>
  );
}

export function RowTitle({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("min-w-0 flex-1 truncate", className)}>
      {children}
    </span>
  );
}

export function TwoLineRow({
  leading,
  title,
  second,
  meta,
  actions,
  onClick,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  second: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group/row relative flex min-w-0 items-start gap-2 px-3 py-1.5 hover:bg-state-hover",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {leading === undefined ? null : (
        <span className="flex h-4.5 shrink-0 items-center">
          <Leading>{leading}</Leading>
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{title}</span>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">{second}</span>
      </span>
      <span className="flex h-4.5 shrink-0 items-center">
        <Trailing meta={meta} actions={actions} />
      </span>
    </div>
  );
}

export const RowIconButton = forwardRef<
  HTMLButtonElement,
  { icon: string; label: string } & Omit<ComponentPropsWithoutRef<typeof Button>, "children">
>(({ icon, label, onClick, className, ...props }, ref) => (
  <Button
    ref={ref}
    type="button"
    variant="ghost"
    size="icon"
    aria-label={label}
    onClick={(event) => {
      event.stopPropagation();
      onClick?.(event);
    }}
    className={cn("size-6.5 shrink-0 text-muted-foreground [&_[data-icon-root]]:size-3.5", className)}
    {...props}
  >
    <Icon name={icon} aria-hidden />
  </Button>
));
RowIconButton.displayName = "RowIconButton";

export const RowMenuTrigger = forwardRef<HTMLButtonElement, { label: string } & Omit<ComponentPropsWithoutRef<typeof Button>, "children">>(
  ({ label, onClick, className, ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
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

export function RowMoreMenu({ label, entries }: { label: string; entries: readonly MenuEntry[] }) {
  return (
    <RowMenu label={label} entries={entries}>
      <RowMenuTrigger label={label} />
    </RowMenu>
  );
}

/** A whole row that is itself the control (disclosure, jump-to). */
export const ActionRow = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof Button>>(({ className, ...props }, ref) => (
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
ActionRow.displayName = "ActionRow";

/** A row title that opens the row: its hit area stretches over the row, so the whole row is one keyboard stop. */
export function RowOpen({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full cursor-pointer truncate text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-1 focus-visible:after:ring-inset focus-visible:after:ring-ring"
    >
      {children}
    </button>
  );
}

export function Chevron({ open, className }: { open: boolean; className?: string }) {
  return <Icon name="ChevronRight" aria-hidden className={cn("size-3.5 shrink-0 text-subtle-foreground", open && "rotate-90", className)} />;
}
