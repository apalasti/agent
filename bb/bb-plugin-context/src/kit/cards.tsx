import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chevron } from "./rows";
import { STATUS, type Status } from "./status";
import { SectionLabel } from "./text";

/** `as="ul"` makes it a list; its cards then sit in `<li>`s. */
export function CardStack({ children, as: Tag = "div", className }: { children: ReactNode; as?: "div" | "ul"; className?: string }) {
  return <Tag className={cn("flex flex-col gap-2 p-3", className)}>{children}</Tag>;
}

/** A filled, borderless card; `relative` so a `RowOpen` title can stretch over it. */
export function Card({ label, children, interactive = false, className }: { label: string; children: ReactNode; interactive?: boolean; className?: string }) {
  return (
    <article
      aria-label={label}
      className={cn("relative flex min-w-0 flex-col gap-1 rounded-xl bg-muted/40 px-4 py-3 text-xs", interactive && "hover:bg-muted/70", className)}
    >
      {children}
    </article>
  );
}

export function CardHeader({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</span>
      {aside === undefined || aside === null ? null : <span className="shrink-0 tabular-nums text-muted-foreground">{aside}</span>}
    </div>
  );
}

export function CardText({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-muted-foreground", className)}>{children}</p>;
}

export function CardSection({
  label,
  aside,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  label: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="mt-3 min-w-0">
      {typeof label === "string" || typeof label === "number" ? (
        <SectionLabel inset={false} aside={aside} className={className}>
          {label}
        </SectionLabel>
      ) : (
        label
      )}
      {children}
    </section>
  );
}

/** One small square per item, coloured by its status. */
export function Ticks({ statuses, label }: { statuses: readonly Status[]; label?: string }) {
  return (
    <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="flex flex-wrap gap-1">
      {statuses.map((status, index) => (
        <span key={index} className={cn("size-2 rounded-sm", status === "idle" ? "bg-muted" : STATUS[status].dot)} />
      ))}
    </span>
  );
}

/** A section header that collapses its section; the chevron sits at the end. */
export function DisclosureHeader({
  title,
  aside,
  open,
  onToggle,
  className,
}: {
  title: ReactNode;
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
        "flex h-auto w-full items-baseline justify-start gap-3 rounded-none px-3 pb-1 pt-3 text-2xs font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate text-left">{title}</span>
      {aside === undefined || aside === null ? null : <span className="shrink-0 text-xs font-normal tabular-nums">{aside}</span>}
      <Chevron open={open} className="self-center" />
    </Button>
  );
}
