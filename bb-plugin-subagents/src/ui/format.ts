import type { Subagent, TranscriptEntry } from "../contract";

export function isRunning(agent: Pick<Subagent, "status">): boolean {
  return agent.status === "running";
}

function startedMs(agent: Subagent): number {
  const ms = agent.startedAt === null ? Number.NaN : Date.parse(agent.startedAt);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Running first, then newest first; agents without a start time sink to the bottom. */
export function orderSubagents(agents: readonly Subagent[]): Subagent[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort((a, b) => {
      const running = Number(isRunning(b.agent)) - Number(isRunning(a.agent));
      if (running !== 0) return running;
      const newest = startedMs(b.agent) - startedMs(a.agent);
      if (newest !== 0 && !Number.isNaN(newest)) return newest;
      return a.index - b.index;
    })
    .map(({ agent }) => agent);
}

export function elapsedMs(agent: Subagent, now: number): number | null {
  if (agent.startedAt === null) return null;
  const start = Date.parse(agent.startedAt);
  if (Number.isNaN(start)) return null;
  const endIso = isRunning(agent) ? null : (agent.finishedAt ?? agent.updatedAt);
  const end = endIso === null ? now : Date.parse(endIso);
  if (Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function activityCounts(agent: Pick<Subagent, "turns" | "toolCalls">): string {
  return `${plural(agent.turns, "turn")} · ${plural(agent.toolCalls, "tool")}`;
}

/** bb's get_subagent_result rows print the id truncated, so its first segment is what users match on. */
export function shortId(agentId: string): string {
  return agentId.split("-")[0] ?? agentId;
}

export type Tally = { running: number; total: number };

export function tally(agents: readonly Pick<Subagent, "status">[]): Tally {
  return { running: agents.filter(isRunning).length, total: agents.length };
}

export function pillText({ running, total }: Tally): string {
  if (running === 0) return plural(total, "subagent");
  const done = total - running;
  return done > 0 ? `${running} running · ${done} done` : `${running} running`;
}

export function pillLabel({ running, total }: Tally): string {
  if (running === 0) return `Subagents: ${total} finished. Open the Subagents panel`;
  return `Subagents: ${running} running, ${total - running} done. Open the Subagents panel`;
}

export const STATUS_LABEL: Record<Subagent["status"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  unknown: "Status unknown",
};

/** The index of the text entry that already shows the final result, so it isn't rendered twice. */
export function finalTextIndex(entries: readonly TranscriptEntry[], result: string | null): number {
  if (result === null) return -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === "tool") continue;
    return entry.kind === "text" && entry.text.trim() === result.trim() ? index : -1;
  }
  return -1;
}

export function toolSummary(name: string, summary: string): string {
  return summary.startsWith(`${name}: `) ? summary.slice(name.length + 2) : summary;
}

export function pollInterval(anyRunning: boolean): number {
  return anyRunning ? 2_000 : 30_000;
}
