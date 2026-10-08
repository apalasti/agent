import { describe, expect, it } from "vitest";
import { foldEvents, type EventRow } from "../src/events";
import { SESSION_ID, WRITES_AGENT, fixtureEvents } from "./fakes";

const withStatus = (row: EventRow, taskStatus: string): EventRow => {
  const data = row.data as { item: Record<string, unknown> };
  const { usage: _usage, ...item } = data.item;
  return { ...row, data: { ...data, item: { ...item, status: "failed", taskStatus } } };
};

describe("foldEvents", () => {
  const rows = fixtureEvents();

  it("reads the Claude session id from thread/identity", () => {
    expect(foldEvents(rows).sessionId).toBe(SESSION_ID);
  });

  it("follows a local agent from started to completed with its total tokens", () => {
    expect(foldEvents(rows).tasks.get(WRITES_AGENT)).toEqual({
      status: "completed",
      startedAt: 1791476315124,
      endedAt: 1791476325306,
      totalTokens: 27357,
    });
  });

  it("shows a started task as running with no end", () => {
    const started = rows.filter((row) => row.type !== "item/backgroundTask/completed");
    expect(foldEvents(started).tasks.get(WRITES_AGENT)).toEqual({
      status: "running",
      startedAt: 1791476315124,
      endedAt: null,
      totalTokens: null,
    });
  });

  it.each(["failed", "killed"])("records a %s task", (status) => {
    const completed = rows.find((row) => row.seq === 475)!;
    const folded = foldEvents(rows.map((row) => (row === completed ? withStatus(row, status) : row)));
    expect(folded.tasks.get(WRITES_AGENT)).toMatchObject({ status, endedAt: completed.createdAt });
  });

  it("ignores background tasks that are not local agents", () => {
    expect([...foldEvents(rows).tasks.keys()]).toEqual(["ac2ffc094213ce47d", WRITES_AGENT]);
  });

  it("folds incrementally into existing facts", () => {
    const facts = foldEvents(rows.slice(0, 5));
    expect(foldEvents(rows.slice(5), facts)).toEqual(foldEvents(rows));
  });
});
