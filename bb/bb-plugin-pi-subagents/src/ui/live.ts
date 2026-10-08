import type { Agent } from "../contract";
import { duration } from "./format";

export type LiveState = { label: string; since: number; inFlight: boolean };

export function liveState(agent: Agent, now: number): LiveState {
  const last = agent.steps[agent.steps.length - 1];
  if (!last) return { label: "starting", since: agent.startedAt ?? now, inFlight: false };
  if (last.kind === "tool" && last.result === null) return { label: `${last.name}: ${last.summary}`, since: last.at, inFlight: true };
  return { label: "thinking", since: last.endAt ?? last.at, inFlight: false };
}

export function liveLabel(agent: Agent, now: number): string {
  const live = liveState(agent, now);
  return live.inFlight ? `${live.label} · ${duration(now - live.since)}` : live.label;
}
