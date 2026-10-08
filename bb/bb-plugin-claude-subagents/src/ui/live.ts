import type { Agent } from "../contract";

export const QUIET_WARN_MS = 60_000;

export type LiveState = { label: string; since: number; inFlight: boolean };

export function liveState(agent: Agent, now: number): LiveState {
  const last = agent.steps[agent.steps.length - 1];
  if (!last) return { label: "starting", since: agent.startedAt ?? now, inFlight: false };
  if (last.kind === "tool" && last.result === null) return { label: `${last.name}: ${last.summary}`, since: last.at, inFlight: true };
  return { label: "thinking", since: last.endAt ?? last.at, inFlight: false };
}

export function contextTone(used: number, window: number): "ok" | "warn" | "critical" {
  const ratio = window > 0 ? used / window : 0;
  if (ratio > 0.85) return "critical";
  if (ratio >= 0.6) return "warn";
  return "ok";
}
