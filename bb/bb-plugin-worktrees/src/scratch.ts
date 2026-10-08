import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  LiveWorkflowThread,
  ScratchEffort,
  ScratchIndex,
  ScratchIssue,
  ScratchSummary,
  ScratchTicket,
  WorkflowThreadMetadata,
} from "./contract";

const TICKET_TYPES = ["research", "prototype", "seam", "grilling", "task"];

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/** `blocked-by: [02, 05]` or `blocked-by: 02, 05` or `blocked-by: []` */
function parseBlockedBy(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((n) => n.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseTitle(content: string, slug: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug;
}

const numberOf = (slug: string) => slug.match(/^(\d+)/)?.[1] ?? slug;

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => join(dir, file));
}

function readTickets(effort: string, dir: string): ScratchTicket[] {
  const raw = markdownFiles(join(dir, "tickets")).map((path) => {
    const content = readFileSync(path, "utf8");
    const frontmatter = parseFrontmatter(content);
    const slug = basename(path, ".md");
    const number = numberOf(slug);
    return {
      ref: `${effort}/${number}`,
      number,
      slug,
      title: parseTitle(content, slug),
      type: frontmatter.type ?? "grilling",
      status: frontmatter.status ?? "open",
      claimed: frontmatter.claimed || null,
      blockedBy: parseBlockedBy(frontmatter["blocked-by"]),
      path,
    };
  });
  const byNumber = new Map(raw.map((ticket) => [ticket.number, ticket]));
  return raw.map((ticket) => {
    const blockers = ticket.blockedBy.filter((n) => byNumber.get(n)?.status !== "closed");
    const state = ticket.status === "closed" ? "done" : blockers.length === 0 ? "frontier" : "blocked";
    return { ...ticket, blockers, state };
  });
}

function readIssues(effort: string, dir: string): ScratchIssue[] {
  return markdownFiles(join(dir, "issues")).map((path) => {
    const content = readFileSync(path, "utf8");
    const slug = basename(path, ".md");
    const number = slug.match(/^(\d+)/)?.[1] ?? "";
    return {
      ref: `${effort}/${number}`,
      number,
      slug,
      title: parseTitle(content, slug),
      status: parseFrontmatter(content).status ?? "needs-plan",
      path,
    };
  });
}

/** An effort is a `.scratch/<slug>/` directory holding a MAP.md, an issues/ directory, or both. */
export function scanScratch(root: string): ScratchIndex {
  const scratchDir = join(root, ".scratch");
  const efforts: ScratchEffort[] = [];
  if (existsSync(scratchDir)) {
    const slugs = readdirSync(scratchDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const slug of slugs) {
      const dir = join(scratchDir, slug);
      const mapPath = existsSync(join(dir, "MAP.md")) ? join(dir, "MAP.md") : null;
      const tickets = mapPath === null ? [] : readTickets(slug, dir);
      const issues = readIssues(slug, dir);
      if (mapPath === null && issues.length === 0) continue;
      efforts.push({
        slug,
        dir,
        mapPath,
        tickets,
        issues,
        handoffReady: mapPath !== null && tickets.every((ticket) => ticket.state === "done"),
      });
    }
  }
  return { root, scratchDir, efforts };
}

export function findEffort(index: ScratchIndex, slug: string): ScratchEffort {
  const effort = index.efforts.find((candidate) => candidate.slug === slug);
  if (effort === undefined) {
    const known = index.efforts.map((candidate) => candidate.slug).join(", ") || "none";
    throw new Error(`No effort "${slug}" in ${index.scratchDir} (efforts: ${known})`);
  }
  return effort;
}

const padNumber = (raw: string) => (/^\d+$/.test(raw) ? raw.padStart(2, "0") : raw);

/** `<effort>/<NN>` → the map ticket, refusing ones a pi /wayfinder picker would not offer. */
export function findRunnableTicket(index: ScratchIndex, ref: string): { effort: ScratchEffort; ticket: ScratchTicket } {
  const match = ref.trim().match(/^([^/]+)\/(\d+)/);
  if (!match?.[1] || !match[2]) throw new Error(`Cannot parse "${ref}"; expected <effort>/<NN>`);
  const effort = findEffort(index, match[1]);
  if (effort.mapPath === null) throw new Error(`Effort ${effort.slug} has no MAP.md`);
  const number = padNumber(match[2]);
  const ticket = effort.tickets.find((candidate) => candidate.number === number);
  if (ticket === undefined) throw new Error(`No ticket ${number} in ${effort.slug}`);
  if (ticket.state === "done") throw new Error(`Ticket ${ticket.ref} is closed`);
  if (ticket.state === "blocked") throw new Error(`Ticket ${ticket.ref} is blocked by ${ticket.blockers.join(", ")}`);
  return { effort, ticket };
}

/** The named open issues of one effort in the order given, or all open ones when none are named. */
export function selectIssues(effort: ScratchEffort, numbers: readonly string[]): ScratchIssue[] {
  const open = effort.issues.filter((issue) => issue.status !== "done");
  if (numbers.length === 0) {
    if (open.length === 0) throw new Error(`Effort ${effort.slug} has no open issues`);
    return open;
  }
  const batch: ScratchIssue[] = [];
  for (const number of [...new Set(numbers.map(padNumber))]) {
    const issue = effort.issues.find((candidate) => candidate.number === number);
    if (issue === undefined) throw new Error(`No issue ${number} in ${effort.slug}`);
    if (issue.status === "done") throw new Error(`Issue ${effort.slug}/${number} is done`);
    batch.push(issue);
  }
  return batch;
}

function readTemplate(templatesDir: string, relativePath: string): string {
  const path = join(templatesDir, relativePath);
  if (!existsSync(path)) throw new Error(`Prompt template ${path} not found; check the templatesDir setting`);
  return readFileSync(path, "utf8");
}

export function promptTimestamp(now = new Date()): string {
  return `${now.toISOString().slice(0, 16)}Z`;
}

function wayfinderPrompt(
  templatesDir: string,
  template: string,
  effort: ScratchEffort,
  ticket: ScratchTicket | null,
  timestamp: string,
): string {
  const bookkeeping = () => readTemplate(templatesDir, "wayfinder/map-bookkeeping.md").trim();
  return readTemplate(templatesDir, `wayfinder/${template}.md`)
    .replace(/\{\{map_path\}\}/g, () => effort.mapPath ?? "")
    .replace(/\{\{effort_dir\}\}/g, () => effort.dir)
    .replace(/\{\{effort\}\}/g, () => effort.slug)
    .replace(/\{\{ticket_path\}\}/g, () => ticket?.path ?? "")
    .replace(/\{\{ticket_title\}\}/g, () => ticket?.title ?? "")
    .replace(/\{\{ticket_type\}\}/g, () => ticket?.type ?? "")
    .replace(/\{\{timestamp\}\}/g, () => timestamp)
    .replace(/\{\{map_bookkeeping\}\}/g, bookkeeping);
}

export function ticketTemplate(ticket: ScratchTicket): string {
  return TICKET_TYPES.includes(ticket.type) ? ticket.type : "grilling";
}

export function ticketPrompt(
  templatesDir: string,
  effort: ScratchEffort,
  ticket: ScratchTicket,
  timestamp = promptTimestamp(),
): string {
  return wayfinderPrompt(templatesDir, ticketTemplate(ticket), effort, ticket, timestamp);
}

export function handoffPrompt(templatesDir: string, effort: ScratchEffort, timestamp = promptTimestamp()): string {
  return wayfinderPrompt(templatesDir, "handoff", effort, null, timestamp);
}

export function chartPrompt(templatesDir: string, root: string, idea: string): string {
  return readTemplate(templatesDir, "wayfinder/chart.md")
    .replace(/\{\{idea\}\}/g, () => idea)
    .replace(/\{\{scratch_dir\}\}/g, () => join(root, ".scratch"));
}

export function orchestratePrompt(templatesDir: string, batch: readonly ScratchIssue[]): string {
  const list = batch.map((i) => `- ${i.number} — ${i.title} — status: ${i.status} — \`${i.path}\``).join("\n");
  return readTemplate(templatesDir, "issues/orchestrate.md").replace(/\{\{issues\}\}/g, () => list);
}

export function summarizeScratch(index: ScratchIndex): ScratchSummary {
  const efforts = index.efforts;
  return {
    readyTickets: efforts.reduce((sum, effort) => sum + effort.tickets.filter((ticket) => ticket.state === "frontier").length, 0),
    openIssues: efforts.reduce((sum, effort) => sum + effort.issues.filter((issue) => issue.status !== "done").length, 0),
    handoffs: efforts.filter((effort) => effort.handoffReady).length,
  };
}

/** A template names a subagent the way orchestrate.md does: the agent name in backticks. */
export function mentionsSubagent(template: string, agentNames: readonly string[]): boolean {
  return agentNames.some((name) => template.includes(`\`${name}\``));
}

/** Which of the index's actions run a template that names one of `agentNames`. */
export function piSubagentActions(
  templatesDir: string,
  index: ScratchIndex,
  agentNames: readonly string[],
): { orchestrate: boolean; tickets: string[] } {
  const cache = new Map<string, boolean>();
  const uses = (relativePath: string) => {
    let hit = cache.get(relativePath);
    if (hit === undefined) {
      const path = join(templatesDir, relativePath);
      hit = existsSync(path) && mentionsSubagent(readFileSync(path, "utf8"), agentNames);
      cache.set(relativePath, hit);
    }
    return hit;
  };
  const tickets = index.efforts.flatMap((effort) =>
    effort.tickets
      .filter((ticket) => ticket.state === "frontier" && uses(`wayfinder/${ticketTemplate(ticket)}.md`))
      .map((ticket) => ticket.ref),
  );
  return { orchestrate: uses("issues/orchestrate.md"), tickets };
}

/** `threads` newest first; the first thread per ticket/issue ref wins. An orchestrate ref `e/01,02` covers each issue. */
export function liveWorkflowThreads(
  threads: readonly { threadId: string; metadata: Partial<WorkflowThreadMetadata> }[],
  root: string,
): LiveWorkflowThread[] {
  const seen = new Map<string, LiveWorkflowThread>();
  const add = (kind: LiveWorkflowThread["kind"], ref: string, threadId: string) => {
    const key = `${kind}:${ref}`;
    if (!seen.has(key)) seen.set(key, { kind, ref, threadId });
  };
  for (const { threadId, metadata } of threads) {
    if (metadata.path !== root || typeof metadata.ref !== "string") continue;
    if (metadata.kind === "ticket") add("ticket", metadata.ref, threadId);
    if (metadata.kind === "orchestrate") {
      const [effort, numbers] = metadata.ref.split("/");
      for (const number of numbers?.split(",") ?? []) add("issue", `${effort}/${number}`, threadId);
    }
  }
  return [...seen.values()];
}
