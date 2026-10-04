import { describe, expect, it } from "vitest";
import { resolveRef, scanScratch, type ScratchIo } from "./scratch";

const TICKET_DONE = `---
type: research
status: closed
blocked-by: []
---

# Pick the store
`;

const ticket = (n: string, opts: { status?: string; blockedBy?: string; claimed?: string; type?: string } = {}) => {
  const lines = [`type: ${opts.type ?? "grilling"}`, `status: ${opts.status ?? "open"}`];
  if (opts.blockedBy !== undefined) lines.push(`blocked-by: ${opts.blockedBy}`);
  if (opts.claimed) lines.push(`claimed: ${opts.claimed}`);
  return `---\n${lines.join("\n")}\n---\n\n# Ticket ${n}\n`;
};

const issue = (n: string, status = "needs-plan") =>
  `---\nstatus: ${status}\n---\n\n# Issue ${n}\n`;

function fakeIo(files: Record<string, string>): ScratchIo {
  return {
    entries: async (dir) => {
      const under = Object.keys(files).filter((p) => p.startsWith(dir + "/"));
      return under.length === 0 ? null : under;
    },
    read: async (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
  };
}

const FIXTURE = {
  "/repo/.scratch/dark-mode/MAP.md": "# Dark mode\n",
  "/repo/.scratch/dark-mode/tickets/01-pick-store.md": TICKET_DONE,
  "/repo/.scratch/dark-mode/tickets/02-pick-palette.md": ticket("02", { blockedBy: "[01]" }),
  "/repo/.scratch/dark-mode/tickets/03-rollout.md": ticket("03", { blockedBy: "[02]", claimed: "2026-01-01T00:00Z" }),
  "/repo/.scratch/dark-mode/issues/01-css-vars.md": issue("01", "ready-to-implement"),
  "/repo/.scratch/dark-mode/issues/02-toggle.md": issue("02", "done"),
  "/repo/.scratch/user-auth/issues/01-schema.md": issue("01"),
};

describe("scanScratch", () => {
  it("returns an empty index when .scratch does not exist", async () => {
    const index = await scanScratch("/repo", fakeIo({}));
    expect(index).toEqual({ efforts: [], features: [], blockedTicketCount: 0 });
  });

  it("parses efforts with tickets and their blocking", async () => {
    const index = await scanScratch("/repo", fakeIo(FIXTURE));
    expect(index.efforts).toHaveLength(1);
    const [effort] = index.efforts;
    expect(effort.slug).toBe("dark-mode");
    expect(effort.mapPath).toBe("/repo/.scratch/dark-mode/MAP.md");
    expect(effort.tickets.map((t) => [t.number, t.blocked])).toEqual([
      ["01", false],
      ["02", false],
      ["03", true],
    ]);
    expect(index.blockedTicketCount).toBe(1);
  });

  it("treats a blocked-by target as blocking until it is closed", async () => {
    const index = await scanScratch("/repo", fakeIo({
      "/repo/.scratch/e/MAP.md": "# E\n",
      "/repo/.scratch/e/tickets/01-a.md": ticket("01"),
      "/repo/.scratch/e/tickets/02-b.md": ticket("02", { blockedBy: "01" }),
    }));
    expect(index.efforts[0].tickets[1].blocked).toBe(true);
  });

  it("parses feature issues, skipping none by status", async () => {
    const index = await scanScratch("/repo", fakeIo(FIXTURE));
    expect(index.features.map((f) => f.slug)).toEqual(["dark-mode", "user-auth"]);
    const dark = index.features[0];
    expect(dark.issues.map((i) => [i.number, i.title, i.status])).toEqual([
      ["01", "Issue 01", "ready-to-implement"],
      ["02", "Issue 02", "done"],
    ]);
  });

  it("reads claims through", async () => {
    const index = await scanScratch("/repo", fakeIo(FIXTURE));
    expect(index.efforts[0].tickets[2].claimed).toBe("2026-01-01T00:00Z");
  });
});

describe("resolveRef", () => {
  it("resolves unqualified refs to the only kind present", async () => {
    const index = await scanScratch("/repo", fakeIo(FIXTURE));
    expect(resolveRef(index, "dark-mode/3").kind).toBe("ticket");
    expect(resolveRef(index, "user-auth/01").kind).toBe("issue");
    // Fixture collides on 01 and 02: both a ticket and an issue carry them.
    expect(() => resolveRef(index, "dark-mode/1")).toThrow(/qualify/);
  });

  it("rejects ambiguous refs with the qualified forms in the message", async () => {
    const index = await scanScratch("/repo", fakeIo({
      "/repo/.scratch/e/MAP.md": "# E\n",
      "/repo/.scratch/e/tickets/01-a.md": ticket("01"),
      "/repo/.scratch/e/issues/01-b.md": issue("01"),
    }));
    expect(() => resolveRef(index, "e/01")).toThrow(/e\/tickets\/01.*e\/issues\/01/);
  });

  it("resolves qualified refs past an ambiguity", async () => {
    const index = await scanScratch("/repo", fakeIo({
      "/repo/.scratch/e/MAP.md": "# E\n",
      "/repo/.scratch/e/tickets/01-a.md": ticket("01"),
      "/repo/.scratch/e/issues/01-b.md": issue("01"),
    }));
    expect(resolveRef(index, "e/tickets/01").kind).toBe("ticket");
    expect(resolveRef(index, "e/issues/01").kind).toBe("issue");
  });

  it("rejects unknown and malformed refs", async () => {
    const index = await scanScratch("/repo", fakeIo(FIXTURE));
    expect(() => resolveRef(index, "dark-mode/99")).toThrow(/Nothing named/);
    expect(() => resolveRef(index, "bogus")).toThrow(/expected <slug>\/<NN>/);
  });
});
