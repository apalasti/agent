import type { TaskState } from "./model";

export const STATE_TEXT: Record<TaskState, string> = {
  running: "text-[oklch(55%_0.16_250)] dark:text-[oklch(72%_0.14_250)]",
  ready: "text-[oklch(58%_0.15_155)] dark:text-[oklch(74%_0.15_155)]",
  blocked: "text-subtle-foreground",
  done: "text-[oklch(55%_0.1_295)] dark:text-[oklch(72%_0.08_295)]",
};

export const STATE_DOT: Record<TaskState, string> = {
  running: "bg-[oklch(55%_0.16_250)] dark:bg-[oklch(72%_0.14_250)] animate-pulse",
  ready: "bg-[oklch(58%_0.15_155)] dark:bg-[oklch(74%_0.15_155)]",
  blocked: "border-[1.5px] border-subtle-foreground",
  done: "bg-[oklch(55%_0.1_295)] dark:bg-[oklch(72%_0.08_295)]",
};

export const STATE_LABEL: Record<TaskState, string> = {
  running: "Running",
  ready: "Ready",
  blocked: "Blocked",
  done: "Done",
};

export const CLAIMED_TEXT = "text-[oklch(60%_0.13_70)] dark:text-[oklch(78%_0.13_80)]";

const TYPE_TEXT: Record<string, string> = {
  grilling: "text-[oklch(48%_0.12_20)] dark:text-[oklch(76%_0.12_20)]",
  research: "text-[oklch(48%_0.12_200)] dark:text-[oklch(76%_0.12_200)]",
  prototype: "text-[oklch(48%_0.12_55)] dark:text-[oklch(76%_0.12_55)]",
  design: "text-[oklch(48%_0.12_335)] dark:text-[oklch(76%_0.12_335)]",
};

const DEFAULT_TYPE_TEXT = "text-[oklch(48%_0.12_260)] dark:text-[oklch(76%_0.12_260)]";

export function typeText(type: string): string {
  return TYPE_TEXT[type] ?? DEFAULT_TYPE_TEXT;
}
