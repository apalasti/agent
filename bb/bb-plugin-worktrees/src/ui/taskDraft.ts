import { useSyncExternalStore } from "react";
import type { TaskWorktreeInputs } from "../contract";

/** While the New task dialog is open it owns the inputs; the composer's chip only mirrors them. */
let dialogInputs: TaskWorktreeInputs | null = null;
const listeners = new Set<() => void>();

export function setDialogTaskInputs(next: TaskWorktreeInputs | null): void {
  dialogInputs = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useDialogTaskInputs(): TaskWorktreeInputs | null {
  return useSyncExternalStore(subscribe, () => dialogInputs);
}

export function cleanInputs(branch: string, from: string): TaskWorktreeInputs {
  const inputs: TaskWorktreeInputs = {};
  if (branch.trim() !== "") inputs.branch = branch.trim();
  if (from.trim() !== "") inputs.from = from.trim();
  return inputs;
}
