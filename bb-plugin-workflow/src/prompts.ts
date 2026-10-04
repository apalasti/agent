import type { ScratchEffort, ScratchIssue, ScratchTicket } from "./scratch";

const TICKET_TYPES = ["research", "prototype", "seam", "grilling", "task"];

export function ticketTemplateName(ticket: Pick<ScratchTicket, "type">): string {
  return TICKET_TYPES.includes(ticket.type) ? ticket.type : "grilling";
}

export interface TemplateSource {
  get(name: string): string | null;
}

export function renderTicketPrompt(
  templates: TemplateSource,
  effort: ScratchEffort,
  effortDir: string,
  ticket: ScratchTicket,
  timestamp: string,
): string | null {
  const template = templates.get(ticketTemplateName(ticket));
  const bookkeeping = templates.get("map-bookkeeping");
  if (template === null || bookkeeping === null) return null;

  return template
    .replace(/\{\{map_path\}\}/g, effort.mapPath)
    .replace(/\{\{effort_dir\}\}/g, effortDir)
    .replace(/\{\{effort\}\}/g, effort.slug)
    .replace(/\{\{ticket_path\}\}/g, ticket.path)
    .replace(/\{\{ticket_title\}\}/g, ticket.title)
    .replace(/\{\{ticket_type\}\}/g, ticket.type)
    .replace(/\{\{timestamp\}\}/g, timestamp)
    .replace(/\{\{map_bookkeeping\}\}/g, () => bookkeeping.trim());
}

export function renderHandoffPrompt(
  templates: TemplateSource,
  effort: ScratchEffort,
  effortDir: string,
  timestamp: string,
): string | null {
  const template = templates.get("handoff");
  const bookkeeping = templates.get("map-bookkeeping");
  if (template === null || bookkeeping === null) return null;

  return template
    .replace(/\{\{map_path\}\}/g, effort.mapPath)
    .replace(/\{\{effort_dir\}\}/g, effortDir)
    .replace(/\{\{effort\}\}/g, effort.slug)
    .replace(/\{\{ticket_path\}\}/g, "")
    .replace(/\{\{ticket_title\}\}/g, "")
    .replace(/\{\{ticket_type\}\}/g, "")
    .replace(/\{\{timestamp\}\}/g, timestamp)
    .replace(/\{\{map_bookkeeping\}\}/g, () => bookkeeping.trim());
}

export function renderChartPrompt(
  templates: TemplateSource,
  idea: string,
  scratchDir: string,
): string | null {
  const template = templates.get("chart");
  if (template === null) return null;
  return template
    .replace(/\{\{idea\}\}/g, idea)
    .replace(/\{\{scratch_dir\}\}/g, scratchDir);
}

export function renderOrchestratePrompt(
  templates: TemplateSource,
  issues: ScratchIssue[],
): string | null {
  const template = templates.get("orchestrate");
  if (template === null) return null;
  const list = issues
    .map((i) => `- ${i.number} — ${i.title} — status: ${i.status} — \`${i.path}\``)
    .join("\n");
  return template.replace(/\{\{issues\}\}/g, list);
}
