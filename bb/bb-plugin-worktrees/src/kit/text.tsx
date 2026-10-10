import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chevron } from "./rows";

export function SectionLabel({
  children,
  aside,
  inset = true,
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  inset?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 text-2xs font-semibold text-muted-foreground",
        inset ? "px-3 pb-1 pt-3" : "px-0.5 pb-1",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {aside === undefined || aside === null ? null : (
        <span className="shrink-0 text-2xs font-normal tabular-nums text-subtle-foreground">{aside}</span>
      )}
    </div>
  );
}

export function Tag({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none tabular-nums text-subtle-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Mono({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("font-mono text-xs", className)}>
      {children}
    </span>
  );
}

export function LinkButton({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <Button type="button" variant="link" onClick={onClick} className={cn("h-auto p-0 text-xs font-normal text-file-accent", className)}>
      {children}
    </Button>
  );
}

export function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", className)} />;
}

export function Sep() {
  return <span aria-hidden>·</span>;
}

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
