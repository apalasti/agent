import { describe, expect, it } from "vitest";
import {
  renderChartPrompt,
  renderHandoffPrompt,
  renderOrchestratePrompt,
  renderTicketPrompt,
  ticketTemplateName,
  type TemplateSource,
} from "./prompts";
import type { ScratchEffort, ScratchIssue, ScratchTicket } from "./scratch";

const templates = (map: Record<string, string>): TemplateSource => ({
  get: (name) => map[name] ?? null,
});

const ticket: ScratchTicket = {
  kind: "ticket",
  effort: "dark-mode",
  number: "02",
  slug: "02-pick-palette",
  title: "Pick the palette",
  type: "grilling",
  status: "open",
  claimed: null,
  blocked: false,
  path: "/repo/.scratch/dark-mode/tickets/02-pick-palette.md",
};

const effort: ScratchEffort = {
  slug: "dark-mode",
  mapPath: "/repo/.scratch/dark-mode/MAP.md",
  tickets: [ticket],
};

describe("ticketTemplateName", () => {
  it("keeps known types and falls back to grilling", () => {
    expect(ticketTemplateName({ type: "seam" })).toBe("seam");
    expect(ticketTemplateName({ type: "bogus" })).toBe("grilling");
  });
});

describe("renderTicketPrompt", () => {
  it("substitutes every variable and inlines the bookkeeping partial", () => {
    const out = renderTicketPrompt(
      templates({
        grilling: "T {{ticket_path}}|{{ticket_title}}|{{map_path}}|{{effort}}|{{effort_dir}}|{{timestamp}}|{{map_bookkeeping}}",
        "map-bookkeeping": "BOOK\n",
      }),
      effort,
      "/repo/.scratch/dark-mode",
      ticket,
      "2026-10-04T10:21Z",
    );
    expect(out).toBe(
      "T /repo/.scratch/dark-mode/tickets/02-pick-palette.md|Pick the palette|/repo/.scratch/dark-mode/MAP.md|dark-mode|/repo/.scratch/dark-mode|2026-10-04T10:21Z|BOOK",
    );
  });

  it("returns null when the template or partial is missing", () => {
    expect(renderTicketPrompt(templates({}), effort, "/", ticket, "t")).toBeNull();
    expect(
      renderTicketPrompt(templates({ grilling: "x {{map_bookkeeping}}" }), effort, "/", ticket, "t"),
    ).toBeNull();
  });
});

describe("renderChartPrompt", () => {
  it("substitutes idea and scratch dir", () => {
    expect(
      renderChartPrompt(templates({ chart: "C {{idea}} @ {{scratch_dir}}" }), "my idea", "/repo/.scratch"),
    ).toBe("C my idea @ /repo/.scratch");
  });
});

describe("renderHandoffPrompt", () => {
  it("renders with empty ticket fields", () => {
    const out = renderHandoffPrompt(
      templates({ handoff: "H {{effort}}/{{ticket_path}}|{{map_bookkeeping}}", "map-bookkeeping": "B" }),
      effort,
      "/repo/.scratch/dark-mode",
      "t",
    );
    expect(out).toBe("H dark-mode/|B");
  });
});

describe("renderOrchestratePrompt", () => {
  const issues: ScratchIssue[] = [
    {
      kind: "issue",
      feature: "dark-mode",
      number: "01",
      slug: "01-css-vars",
      title: "CSS variables",
      status: "ready-to-implement",
      path: "/repo/.scratch/dark-mode/issues/01-css-vars.md",
    },
  ];

  it("renders the issue list", () => {
    expect(renderOrchestratePrompt(templates({ orchestrate: "O:\n{{issues}}" }), issues)).toBe(
      "O:\n- 01 — CSS variables — status: ready-to-implement — `/repo/.scratch/dark-mode/issues/01-css-vars.md`",
    );
  });
});
