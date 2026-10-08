import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chartPrompt,
  findEffort,
  findRunnableTicket,
  handoffPrompt,
  liveWorkflowThreads,
  mentionsSubagent,
  orchestratePrompt,
  piSubagentActions,
  scanScratch,
  selectIssues,
  summarizeScratch,
  ticketPrompt,
} from "../src/scratch";
import { write } from "./repo";

const ticket = (n: string, opts: { status?: string; blockedBy?: string; claimed?: string; type?: string } = {}) => {
  const lines = [`type: ${opts.type ?? "grilling"}`, `status: ${opts.status ?? "open"}`];
  if (opts.blockedBy !== undefined) lines.push(`blocked-by: ${opts.blockedBy}`);
  if (opts.claimed) lines.push(`claimed: ${opts.claimed}`);
  return `---\n${lines.join("\n")}\n---\n\n# Ticket ${n}\n\n## Question\n`;
};
const issue = (n: string, status?: string) => `${status ? `---\nstatus: ${status}\n---\n\n` : ""}# Issue ${n}\n`;

let root: string;
let templates: string;

function writeAll(base: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) write(join(base, path), content);
}

beforeEach(() => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "wt-scratch-")));
  root = join(tmp, "repo");
  templates = join(tmp, "templates");
  writeAll(root, {
    ".scratch/.gitignore": "*\n",
    ".scratch/demo/MAP.md": "# Demo\n",
    ".scratch/demo/tickets/01-name.md": ticket("01", { status: "closed", blockedBy: "[]" }),
    ".scratch/demo/tickets/02-cli.md": ticket("02", { blockedBy: "[01]", type: "task", claimed: "2026-10-04T14:59Z" }),
    ".scratch/demo/tickets/03-run.md": ticket("03", { blockedBy: "02, 01", type: "seam" }),
    ".scratch/demo/tickets/04-ghost.md": ticket("04", { blockedBy: "[09]", type: "weird" }),
    ".scratch/demo/issues/01-report.md": issue("01", "ready-to-implement"),
    ".scratch/demo/issues/02-quirks.md": issue("02", "done"),
    ".scratch/auth/issues/01-schema.md": issue("01"),
    ".scratch/auth/issues/03-login.md": issue("03", "in-progress"),
    ".scratch/notes/research/x.md": "loose notes\n",
  });
  writeAll(templates, {
    "wayfinder/grilling.md": "G {{ticket_path}} {{map_path}} {{timestamp}}\n{{map_bookkeeping}}\n",
    "wayfinder/seam.md": "S {{effort}} {{effort_dir}} {{ticket_title}} {{ticket_type}}\n",
    "wayfinder/task.md": "T {{ticket_path}}\n",
    "wayfinder/map-bookkeeping.md": "\n  bookkeeping $& $1\n\n",
    "wayfinder/handoff.md": "H {{effort}} {{map_path}} [{{ticket_path}}]\n",
    "wayfinder/chart.md": "C {{idea}} {{scratch_dir}}\n",
    "issues/orchestrate.md": "O\n{{issues}}\nend\n",
  });
});
afterEach(() => rmSync(join(root, ".."), { recursive: true, force: true }));

describe("scanScratch", () => {
  it("returns no efforts without .scratch", () => {
    rmSync(join(root, ".scratch"), { recursive: true });
    expect(scanScratch(root)).toEqual({ root, scratchDir: join(root, ".scratch"), efforts: [] });
  });

  it("lists map efforts and issue-only efforts, skipping directories with neither", () => {
    const index = scanScratch(root);
    expect(index.efforts.map((effort) => [effort.slug, effort.mapPath !== null])).toEqual([
      ["auth", false],
      ["demo", true],
    ]);
  });

  it("puts each ticket on the frontier, blocked, or done", () => {
    const demo = findEffort(scanScratch(root), "demo");
    expect(demo.tickets.map((t) => [t.ref, t.state, t.blockers, t.claimed])).toEqual([
      ["demo/01", "done", [], null],
      ["demo/02", "frontier", [], "2026-10-04T14:59Z"],
      ["demo/03", "blocked", ["02"], null],
      ["demo/04", "blocked", ["09"], null],
    ]);
    expect(demo.tickets[2]?.blockedBy).toEqual(["02", "01"]);
    expect(demo.tickets[0]?.title).toBe("Ticket 01");
    expect(demo.handoffReady).toBe(false);
  });

  it("is ready to hand off once every ticket is closed", () => {
    writeAll(root, {
      ".scratch/done/MAP.md": "# Done\n",
      ".scratch/done/tickets/01-a.md": ticket("01", { status: "closed" }),
    });
    expect(findEffort(scanScratch(root), "done").handoffReady).toBe(true);
  });

  it("reads issues with their status, defaulting to needs-plan", () => {
    const auth = findEffort(scanScratch(root), "auth");
    expect(auth.issues.map((i) => [i.ref, i.status, i.title])).toEqual([
      ["auth/01", "needs-plan", "Issue 01"],
      ["auth/03", "in-progress", "Issue 03"],
    ]);
  });
});

describe("selection", () => {
  it("runs frontier tickets by <effort>/<NN>, padding the number", () => {
    expect(findRunnableTicket(scanScratch(root), "demo/2").ticket.slug).toBe("02-cli");
  });

  it("refuses closed, blocked, and unknown tickets", () => {
    const index = scanScratch(root);
    expect(() => findRunnableTicket(index, "demo/01")).toThrow(/closed/);
    expect(() => findRunnableTicket(index, "demo/03")).toThrow(/blocked by 02/);
    expect(() => findRunnableTicket(index, "demo/07")).toThrow(/No ticket 07/);
    expect(() => findRunnableTicket(index, "nope/01")).toThrow(/No effort "nope"/);
    expect(() => findRunnableTicket(index, "auth/01")).toThrow(/no MAP.md/);
    expect(() => findRunnableTicket(index, "demo")).toThrow(/expected <effort>\/<NN>/);
  });

  it("selects named open issues in order, or every open one", () => {
    const index = scanScratch(root);
    expect(selectIssues(findEffort(index, "auth"), ["3", "01", "03"]).map((i) => i.number)).toEqual(["03", "01"]);
    expect(selectIssues(findEffort(index, "demo"), []).map((i) => i.number)).toEqual(["01"]);
    expect(() => selectIssues(findEffort(index, "demo"), ["02"])).toThrow(/is done/);
    expect(() => selectIssues(findEffort(index, "auth"), ["09"])).toThrow(/No issue 09/);
  });
});

describe("prompts", () => {
  it("fills a ticket's type template, falling back to grilling", () => {
    const index = scanScratch(root);
    const demo = findEffort(index, "demo");
    const [, cli, run, ghost] = demo.tickets;
    expect(ticketPrompt(templates, demo, run!, "T0")).toBe(
      `S demo ${join(root, ".scratch/demo")} Ticket 03 seam\n`,
    );
    expect(ticketPrompt(templates, demo, cli!, "T0")).toBe(`T ${cli!.path}\n`);
    expect(ticketPrompt(templates, demo, ghost!, "2026-10-06T10:00Z")).toBe(
      `G ${ghost!.path} ${join(root, ".scratch/demo/MAP.md")} 2026-10-06T10:00Z\nbookkeeping $& $1\n`,
    );
  });

  it("fills handoff with empty ticket fields", () => {
    const demo = findEffort(scanScratch(root), "demo");
    expect(handoffPrompt(templates, demo, "T0")).toBe(`H demo ${demo.mapPath} []\n`);
  });

  it("fills chart with the idea and the worktree's .scratch", () => {
    expect(chartPrompt(templates, root, "cost $& tracking")).toBe(`C cost $& tracking ${join(root, ".scratch")}\n`);
  });

  it("lists the orchestrate batch one line per issue", () => {
    const auth = findEffort(scanScratch(root), "auth");
    expect(orchestratePrompt(templates, selectIssues(auth, ["03", "01"]))).toBe(
      `O\n- 03 — Issue 03 — status: in-progress — \`${auth.issues[1]!.path}\`\n- 01 — Issue 01 — status: needs-plan — \`${auth.issues[0]!.path}\`\nend\n`,
    );
  });

  it("names the missing template file", () => {
    const demo = findEffort(scanScratch(root), "demo");
    expect(() => handoffPrompt(join(templates, "nope"), demo)).toThrow(/nope\/wayfinder\/handoff\.md not found/);
  });

  it("leaves no placeholder unfilled in the real pi templates", () => {
    const real = fileURLToPath(new URL("../../extensions", import.meta.url));
    const index = scanScratch(root);
    const demo = findEffort(index, "demo");
    const prompts = [
      ...["research", "prototype", "seam", "grilling", "task"].map((type) =>
        ticketPrompt(real, demo, { ...demo.tickets[1]!, type }),
      ),
      handoffPrompt(real, demo),
      chartPrompt(real, root, "idea"),
      orchestratePrompt(real, findEffort(index, "auth").issues),
    ];
    for (const prompt of prompts) expect(prompt).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe("summarizeScratch", () => {
  it("counts frontier tickets, open issues, and maps ready to hand off", () => {
    expect(summarizeScratch(scanScratch(root))).toEqual({ readyTickets: 1, openIssues: 3, handoffs: 0 });
  });
});

describe("pi subagents", () => {
  const agents = ["issue-planner", "Plan"];

  it("matches an agent name only in backticks", () => {
    expect(mentionsSubagent("Spawn `issue-planner` first", agents)).toBe(true);
    expect(mentionsSubagent("Plan, do not do.", agents)).toBe(false);
  });

  it("flags orchestrate and the frontier tickets whose template names a subagent", () => {
    write(join(templates, "wayfinder", "task.md"), "Ask `Plan` for help with {{ticket_path}}\n");
    expect(piSubagentActions(templates, scanScratch(root), agents)).toEqual({ orchestrate: false, tickets: ["demo/02"] });
    write(join(templates, "issues", "orchestrate.md"), "Spawn `issue-planner`\n");
    expect(piSubagentActions(templates, scanScratch(root), agents).orchestrate).toBe(true);
    expect(piSubagentActions(join(templates, "nope"), scanScratch(root), agents)).toEqual({ orchestrate: false, tickets: [] });
  });

  it("finds subagents in the real orchestrate template", () => {
    const real = fileURLToPath(new URL("../../extensions", import.meta.url));
    expect(piSubagentActions(real, scanScratch(root), ["issue-planner", "issue-implementer"]).orchestrate).toBe(true);
  });
});

describe("liveWorkflowThreads", () => {
  it("keeps the newest thread per ref, splits orchestrate batches into issues, and skips other worktrees", () => {
    const live = liveWorkflowThreads(
      [
        { threadId: "t3", metadata: { kind: "ticket", effort: "demo", ref: "demo/02", path: root } },
        { threadId: "t2", metadata: { kind: "ticket", effort: "demo", ref: "demo/02", path: root } },
        { threadId: "t1", metadata: { kind: "orchestrate", effort: "auth", ref: "auth/01,03", path: root } },
        { threadId: "t0", metadata: { kind: "ticket", effort: "demo", ref: "demo/03", path: "/elsewhere" } },
        { threadId: "tc", metadata: { kind: "chart", effort: null, ref: null, path: root } },
        { threadId: "tx", metadata: {} },
      ],
      root,
    );
    expect(live).toEqual([
      { kind: "ticket", ref: "demo/02", threadId: "t3" },
      { kind: "issue", ref: "auth/01", threadId: "t1" },
      { kind: "issue", ref: "auth/03", threadId: "t1" },
    ]);
  });
});
