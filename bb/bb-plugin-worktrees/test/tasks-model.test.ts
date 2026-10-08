import { describe, expect, it } from "vitest";
import type { ScratchEffort, ScratchIssue, ScratchTicket } from "../src/contract";
import { effortModel, legend } from "../src/ui/tasks/model";

const ticket = (number: string, overrides: Partial<ScratchTicket> = {}): ScratchTicket => ({
  ref: `demo/${number}`,
  number,
  slug: `t${number}`,
  title: `Ticket ${number}`,
  type: "task",
  status: "open",
  claimed: null,
  blockedBy: [],
  blockers: [],
  state: "frontier",
  path: `/w/.scratch/demo/tickets/${number}.md`,
  ...overrides,
});

const issue = (number: string, status = "needs-plan"): ScratchIssue => ({
  ref: `demo/${number}`,
  number,
  slug: `i${number}`,
  title: `Issue ${number}`,
  status,
  path: `/w/.scratch/demo/issues/${number}.md`,
});

const effort = (tickets: ScratchTicket[], issues: ScratchIssue[] = []): ScratchEffort => ({
  slug: "demo",
  dir: "/w/.scratch/demo",
  mapPath: "/w/.scratch/demo/MAP.md",
  tickets,
  issues,
  handoffReady: tickets.every((candidate) => candidate.state === "done"),
});

const refs = (rows: readonly { ref: string }[]) => rows.map((row) => row.ref);

describe("effortModel", () => {
  it("puts a ticket with a live thread in running even when it is on the frontier", () => {
    const model = effortModel(effort([ticket("01"), ticket("02")]), new Map([["ticket:demo/01", "thr_1"]]));
    expect(refs(model.groups.running)).toEqual(["demo/01"]);
    expect(model.groups.running[0]?.threadId).toBe("thr_1");
    expect(refs(model.groups.ready)).toEqual(["demo/02"]);
  });

  it("moves a ticket from blocked to ready once its blocker closes", () => {
    const blocked = effort([ticket("01"), ticket("02", { blockedBy: ["01"], blockers: ["01"], state: "blocked" })]);
    const before = effortModel(blocked, new Map());
    expect(refs(before.groups.blocked)).toEqual(["demo/02"]);
    expect(before.groups.blocked[0]?.blockers).toEqual([{ number: "01", title: "Ticket 01" }]);

    const closed = effort([ticket("01", { status: "done", state: "done" }), ticket("02", { blockedBy: ["01"], blockers: [] })]);
    const after = effortModel(closed, new Map());
    expect(refs(after.groups.ready)).toEqual(["demo/02"]);
    expect(refs(after.groups.done)).toEqual(["demo/01"]);
    expect(after.progress).toEqual({ done: 1, total: 2 });
  });

  it("offers hand-off only when no ticket is open", () => {
    expect(effortModel(effort([ticket("01", { state: "done" }), ticket("02")]), new Map()).handoffReady).toBe(false);
    expect(effortModel(effort([ticket("01", { state: "done" })]), new Map()).handoffReady).toBe(true);
  });

  it("batches open issues and exposes the live batch thread", () => {
    const model = effortModel(effort([], [issue("01"), issue("02", "done")]), new Map([["issue:demo/01", "thr_batch"]]));
    expect(refs(model.batch.open)).toEqual(["demo/01"]);
    expect(model.batch.threadId).toBe("thr_batch");
    expect(model.groups).toEqual({ running: [], ready: [], blocked: [], done: [] });
  });
});

describe("legend", () => {
  it("sums ticket states across efforts", () => {
    const a = effortModel(effort([ticket("01"), ticket("02", { state: "done" })]), new Map([["ticket:demo/01", "t"]]));
    const b = effortModel(effort([ticket("03", { state: "blocked", blockers: ["04"] })]), new Map());
    expect(legend([a, b])).toEqual({ running: 1, ready: 0, blocked: 1, done: 1 });
  });
});
