import type { ScratchEffort, ScratchView } from "../../contract";

export type TaskState = "running" | "ready" | "blocked" | "done";

export type TaskRow = {
  kind: "ticket" | "issue";
  ref: string;
  number: string;
  title: string;
  type: string | null;
  state: TaskState;
  claimed: string | null;
  blockers: readonly { number: string; title: string }[];
  threadId: string | null;
};

export type EffortModel = {
  slug: string;
  progress: { done: number; total: number };
  groups: Record<TaskState, readonly TaskRow[]>;
  batch: { open: readonly TaskRow[]; threadId: string | null };
  handoffReady: boolean;
};

/** The thread to open per `ticket:<ref>` / `issue:<ref>`. */
export type LiveThreads = ReadonlyMap<string, string>;

export function liveThreadMap(view: ScratchView | null): LiveThreads {
  return new Map(view?.liveThreads.map((live) => [`${live.kind}:${live.ref}`, live.threadId]) ?? []);
}

export function effortModel(effort: ScratchEffort, live: LiveThreads): EffortModel {
  const titleOf = (number: string) => effort.tickets.find((ticket) => ticket.number === number)?.title ?? "missing ticket";
  const groups: Record<TaskState, TaskRow[]> = { running: [], ready: [], blocked: [], done: [] };

  for (const ticket of effort.tickets) {
    const threadId = live.get(`ticket:${ticket.ref}`) ?? null;
    const state: TaskState =
      ticket.state === "done" ? "done" : threadId !== null ? "running" : ticket.state === "frontier" ? "ready" : "blocked";
    groups[state].push({
      kind: "ticket",
      ref: ticket.ref,
      number: ticket.number,
      title: ticket.title,
      type: ticket.type,
      state,
      claimed: ticket.claimed,
      blockers: ticket.blockers.map((number) => ({ number, title: titleOf(number) })),
      threadId,
    });
  }

  const issues: TaskRow[] = effort.issues.map((issue) => ({
    kind: "issue",
    ref: issue.ref,
    number: issue.number,
    title: issue.title,
    type: null,
    state: issue.status === "done" ? "done" : "ready",
    claimed: null,
    blockers: [],
    threadId: live.get(`issue:${issue.ref}`) ?? null,
  }));
  const open = issues.filter((issue) => issue.state !== "done");

  return {
    slug: effort.slug,
    progress: { done: groups.done.length, total: effort.tickets.length },
    groups,
    batch: { open, threadId: open.find((issue) => issue.threadId !== null)?.threadId ?? null },
    handoffReady: effort.handoffReady,
  };
}

export function legend(models: readonly EffortModel[]): Record<TaskState, number> {
  const counts: Record<TaskState, number> = { running: 0, ready: 0, blocked: 0, done: 0 };
  for (const model of models) {
    for (const state of Object.keys(counts) as TaskState[]) counts[state] += model.groups[state].length;
  }
  return counts;
}
