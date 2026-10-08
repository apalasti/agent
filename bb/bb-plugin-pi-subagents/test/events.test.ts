import { describe, expect, it } from "vitest";
import { foldEvents, type EventRow } from "../src/events";

const identity = (seq: number, providerThreadId: string): EventRow => ({
  seq,
  type: "thread/identity",
  createdAt: 1791489139842 + seq,
  data: { providerThreadId },
});

describe("foldEvents", () => {
  it("reads the pi session id from thread/identity", () => {
    expect(foldEvents([identity(16, "pi_e6c62b6b-9ba7-4f95-85af-6183a2877e86")]).providerThreadId).toBe(
      "pi_e6c62b6b-9ba7-4f95-85af-6183a2877e86",
    );
  });

  it("keeps the last id and ignores other events", () => {
    const rows = [identity(1, "pi_old"), { seq: 2, type: "item/started", createdAt: 0, data: {} }, identity(3, "pi_new")];
    expect(foldEvents(rows).providerThreadId).toBe("pi_new");
  });

  it("has no id without a thread/identity event", () => {
    expect(foldEvents([]).providerThreadId).toBeNull();
  });

  it("folds incrementally into existing facts", () => {
    const facts = foldEvents([identity(1, "pi_old")]);
    expect(foldEvents([identity(2, "pi_new")], facts)).toBe(facts);
    expect(facts.providerThreadId).toBe("pi_new");
  });
});
