import type { ReactNode } from "react";

export const GAUGE_ICON = "context-gauge";
export const FORK_ICON = "context-fork";
export const COMPACT_ICON = "context-compact";
export const CLEAR_ICON = "context-clear";

function Glyph({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function GaugeGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M3.75 17.25a8.25 8.25 0 1 1 16.5 0" />
      <path d="M12 17.25 15.75 11.5" />
      <path d="M6.5 11.25 7.6 12M12 6.75V8.1M17.5 11.25l-1.1.75" />
      <path d="M3.75 20.25h16.5" />
    </Glyph>
  );
}

export function ForkGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <circle cx="6.5" cy="5.5" r="2" />
      <circle cx="17.5" cy="5.5" r="2" />
      <circle cx="12" cy="18.5" r="2" />
      <path d="M6.5 7.5v1.75c0 1.66 1.34 3 3 3h5c1.66 0 3-1.34 3-3V7.5M12 12.25v4.25" />
    </Glyph>
  );
}

export function CompactGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M12 3.75V9.5M9 6.5l3 3 3-3M12 20.25V14.5M9 17.5l3-3 3 3M4.75 12h14.5" />
    </Glyph>
  );
}

export function ClearGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="m8.5 19.25-4-4a1.5 1.5 0 0 1 0-2.12l8.38-8.38a1.5 1.5 0 0 1 2.12 0l4.25 4.25a1.5 1.5 0 0 1 0 2.12l-7.5 7.5" />
      <path d="M8.5 19.25h11M9.25 8.5l6.25 6.25" />
    </Glyph>
  );
}
