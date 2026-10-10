import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Spinner } from "./status";
import { LinkButton, SectionLabel } from "./text";

export function PanelState({
  kind,
  title,
  children,
  onRetry,
}: {
  kind: "loading" | "empty" | "unavailable" | "error";
  title?: ReactNode;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground"
    >
      {kind === "loading" ? <Spinner /> : null}
      {title ? <p className="font-medium text-foreground">{title}</p> : null}
      {children ? <p className={kind === "error" ? "text-destructive-text" : undefined}>{children}</p> : null}
      {kind === "error" && onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function InlineNote({ children, className, role }: { children: ReactNode; className?: string; role?: "alert" | "status" }) {
  return (
    <p role={role} className={cn("px-3 py-2 text-xs text-muted-foreground", className)}>
      {children}
    </p>
  );
}

export function Callout({
  tone,
  children,
  onRetry,
  className,
}: {
  tone: "error" | "warning";
  children: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "mx-3 my-2 flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-xs",
        tone === "error"
          ? "border-surface-destructive-border bg-surface-destructive text-destructive-text"
          : "border-transparent bg-surface-attention text-warning-text",
        className,
      )}
    >
      {tone === "warning" ? <Icon name="AlertTriangle" aria-hidden className="mt-px size-3.5 shrink-0" /> : null}
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry ? (
        <LinkButton className="shrink-0" onClick={onRetry}>
          Retry
        </LinkButton>
      ) : null}
    </div>
  );
}

export function PanelToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex h-10 shrink-0 items-center gap-1 border-b border-border-hairline px-2", className)}>{children}</div>;
}

export const ToolbarButton = forwardRef<
  HTMLButtonElement,
  { icon: string; label: string; pressed?: boolean; spinning?: boolean } & Omit<ComponentPropsWithoutRef<typeof Button>, "children">
>(({ icon, label, pressed, spinning, className, ...props }, ref) => (
  <Button
    ref={ref}
    type="button"
    variant="ghost"
    size="icon"
    aria-label={label}
    aria-pressed={pressed}
    className={cn("size-7 shrink-0 text-muted-foreground [&_[data-icon-root]]:size-3.5", className)}
    {...props}
  >
    <Icon name={spinning ? "Loading" : icon} aria-hidden className={spinning ? "animate-spin motion-reduce:animate-none" : undefined} />
  </Button>
));
ToolbarButton.displayName = "ToolbarButton";

export function PanelFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex shrink-0 flex-wrap items-center gap-2 border-t border-border-hairline px-3 py-2", className)}>{children}</div>;
}

export function SubViewHeader({ title, onBack }: { title: ReactNode; onBack: () => void }) {
  return (
    <PanelToolbar>
      <ToolbarButton icon="ChevronLeft" label="Back" onClick={onBack} />
      <h2 className="min-w-0 truncate text-sm font-medium">{title}</h2>
    </PanelToolbar>
  );
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>;
}

export function Group({
  label,
  aside,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  label?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <section aria-label={ariaLabel} className={cn("border-t border-border-hairline pb-1 first:border-t-0", !label && "pt-1", className)}>
      {label ? <SectionLabel aside={aside}>{label}</SectionLabel> : null}
      {children}
    </section>
  );
}

export function CodeWell({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "muted" | "error"; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md px-2.5 py-2 font-mono text-xs leading-relaxed",
        tone === "error" ? "bg-surface-destructive text-destructive-text" : "bg-surface-recessed",
        tone === "muted" && "text-muted-foreground",
        tone === "default" && "text-foreground",
        className,
      )}
    >
      {children}
    </pre>
  );
}

export type MeterSegment = { value: number; className: string; label?: string };

export function Meter({
  segments,
  max,
  tick,
  label,
  size = "sm",
  className,
}: {
  segments: readonly MeterSegment[];
  max: number;
  tick?: { value: number; label: string };
  label: string;
  size?: "sm" | "lg";
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const share = (value: number) => `${Math.min(100, Math.max(0, (value / max) * 100))}%`;
  return (
    <div className={cn("relative", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={total}
        className={cn("flex w-full overflow-hidden rounded-full bg-muted", size === "lg" ? "h-3" : "h-1.5")}
      >
        {segments.map((segment, index) => (
          <div key={index} title={segment.label} className={cn("h-full shrink-0", segment.className)} style={{ width: share(segment.value) }} />
        ))}
      </div>
      {tick ? (
        <div
          title={tick.label}
          className={cn("absolute w-0.5 -translate-x-1/2 rounded-full bg-foreground", size === "lg" ? "-top-1 h-5" : "-top-0.5 h-2.5")}
          style={{ left: share(tick.value) }}
        />
      ) : null}
    </div>
  );
}

export const HeaderPill = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof Button>>(({ className, children, ...props }, ref) => (
  <Button
    ref={ref}
    type="button"
    variant="ghost"
    size="sm"
    className={cn("h-7 max-w-80 shrink-0 gap-1.5 px-2 text-xs font-normal tabular-nums [&_[data-icon-root]]:size-3.5", className)}
    {...props}
  >
    {children}
  </Button>
));
HeaderPill.displayName = "HeaderPill";

/** Outline action sized to sit inside an h-7 row; the vendored size=sm is 32px. */
export const RowButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof Button>>(({ className, ...props }, ref) => (
  <Button ref={ref} type="button" variant="outline" size="sm" className={cn("h-6.5 px-2 text-xs", className)} {...props} />
));
RowButton.displayName = "RowButton";
