import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

// ─── types ────────────────────────────────────────────────────────────────────

interface Ticket {
  path: string;
  number: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  blockedBy: string[];
}

interface Effort {
  slug: string;
  dir: string;
  mapPath: string;
  tickets: Ticket[];
}

/** What the user picked, and which prompt template answers it. */
interface Choice {
  label: string;
  template: string;
  effort: Effort;
  ticket?: Ticket;
}

const TICKET_TYPES = ["research", "prototype", "grilling", "task"];

// ─── parsing ──────────────────────────────────────────────────────────────────

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
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

/** The ticket's name is its `# ` heading; the slug is the fallback. */
function parseTitle(content: string, slug: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : slug;
}

function readTicket(path: string): Ticket {
  const content = readFileSync(path, "utf8");
  const frontmatter = parseFrontmatter(content);
  const slug = basename(path, ".md");
  const number = slug.match(/^(\d+)/)?.[1] ?? slug;

  return {
    path,
    number,
    slug,
    title: parseTitle(content, slug),
    type: frontmatter.type ?? "grilling",
    status: frontmatter.status ?? "open",
    blockedBy: parseBlockedBy(frontmatter["blocked-by"]),
  };
}

// ─── discovery ────────────────────────────────────────────────────────────────

async function getRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    timeout: 5_000,
  });
  return result.code === 0 ? result.stdout.trim() : cwd;
}

/** An effort is a `.scratch/<slug>/` directory holding a MAP.md. */
function findEfforts(root: string): Effort[] {
  const scratchDir = join(root, ".scratch");
  if (!existsSync(scratchDir)) return [];

  const efforts: Effort[] = [];

  for (const entry of readdirSync(scratchDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const dir = join(scratchDir, entry.name);
    const mapPath = join(dir, "MAP.md");
    if (!existsSync(mapPath)) continue;

    const ticketsDir = join(dir, "tickets");
    const tickets = existsSync(ticketsDir)
      ? readdirSync(ticketsDir)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .map((f) => readTicket(join(ticketsDir, f)))
      : [];

    efforts.push({ slug: entry.name, dir, mapPath, tickets });
  }

  return efforts;
}

// ─── the frontier ─────────────────────────────────────────────────────────────

/** A ticket is unblocked when every ticket it names is closed. */
function isUnblocked(ticket: Ticket, byNumber: Map<string, Ticket>): boolean {
  return ticket.blockedBy.every((n) => byNumber.get(n)?.status === "closed");
}

function partitionOpen(effort: Effort): { frontier: Ticket[]; blocked: Ticket[] } {
  const byNumber = new Map(effort.tickets.map((t) => [t.number, t]));
  const open = effort.tickets.filter((t) => t.status !== "closed");

  return {
    frontier: open.filter((t) => isUnblocked(t, byNumber)),
    blocked: open.filter((t) => !isUnblocked(t, byNumber)),
  };
}

// ─── choices ──────────────────────────────────────────────────────────────────

/**
 * One row per frontier ticket, so the user selects the ticket itself. Blocked
 * tickets are left out: pi's `select` takes plain strings and cannot render a
 * row the user is unable to choose. Their count goes in the picker title.
 */
function buildChoices(efforts: Effort[]): { choices: Choice[]; blockedCount: number } {
  const choices: Choice[] = [];
  let blockedCount = 0;

  for (const effort of efforts) {
    const { frontier, blocked } = partitionOpen(effort);
    blockedCount += blocked.length;

    for (const ticket of frontier) {
      const template = TICKET_TYPES.includes(ticket.type) ? ticket.type : "grilling";
      choices.push({
        label: `${effort.slug} / #${ticket.number} [${ticket.type}] ${ticket.title}`,
        template,
        effort,
        ticket,
      });
    }

    // Frontier empty: either the map is done, or everything left is blocked.
    if (frontier.length === 0 && blocked.length === 0) {
      choices.push({
        label: `${effort.slug} / ⚑ frontier empty — hand off to to-prd`,
        template: "handoff",
        effort,
      });
    }
  }

  return { choices, blockedCount };
}

// ─── prompts ──────────────────────────────────────────────────────────────────

function buildPrompt(choice: Choice, promptDir: string): string | null {
  const templatePath = join(promptDir, `${choice.template}.md`);
  if (!existsSync(templatePath)) return null;

  const timestamp = new Date().toISOString().slice(0, 16) + "Z";

  return readFileSync(templatePath, "utf8")
    .replace(/\{\{map_path\}\}/g, choice.effort.mapPath)
    .replace(/\{\{effort_dir\}\}/g, choice.effort.dir)
    .replace(/\{\{effort\}\}/g, choice.effort.slug)
    .replace(/\{\{ticket_path\}\}/g, choice.ticket?.path ?? "")
    .replace(/\{\{ticket_title\}\}/g, choice.ticket?.title ?? "")
    .replace(/\{\{ticket_type\}\}/g, choice.ticket?.type ?? "")
    .replace(/\{\{timestamp\}\}/g, timestamp);
}

function buildChartPrompt(idea: string, root: string, promptDir: string): string | null {
  const templatePath = join(promptDir, "chart.md");
  if (!existsSync(templatePath)) return null;

  return readFileSync(templatePath, "utf8")
    .replace(/\{\{idea\}\}/g, idea)
    .replace(/\{\{scratch_dir\}\}/g, join(root, ".scratch"));
}

function appendUserPrompt(basePrompt: string, userPrompt?: string): string {
  const extra = userPrompt?.trim();
  if (!extra) return basePrompt;

  return `${basePrompt}\n\n## Additional instructions from user\n${extra}`;
}

// ─── extension ────────────────────────────────────────────────────────────────

const CHART_LABEL = "＋ chart a new map";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("wayfinder", {
    description: "Pick a wayfinder ticket and prepare the prompt in the editor",
    handler: async (args, ctx) => {
      const root = await getRepoRoot(pi, ctx.cwd);
      const efforts = findEfforts(root);
      const { choices, blockedCount } = buildChoices(efforts);

      const labels = [...choices.map((c) => c.label), CHART_LABEL];
      const title =
        blockedCount === 0
          ? "Select a ticket to resolve:"
          : `Select a ticket to resolve (${blockedCount} blocked, hidden):`;

      const selected = await ctx.ui.select(title, labels);
      if (!selected) return;

      // Charting starts from a loose idea, so there is nothing on disk to pick.
      if (selected === CHART_LABEL) {
        const idea =
          args?.trim() ||
          (await ctx.ui.input("What is the idea?", "one or two lines"))?.trim();
        if (!idea) return;

        const prompt = buildChartPrompt(idea, root, __dirname);
        if (!prompt) {
          ctx.ui.notify("No chart.md template found next to the extension", "error");
          return;
        }
        ctx.ui.setEditorText(`${prompt}\n\n`);
        ctx.ui.notify(
          "Charting prompt added to editor. Add any extra context, then press Enter to run.",
          "info",
        );
        return;
      }

      const choice = choices.find((c) => c.label === selected);
      if (!choice) return;

      const prompt = buildPrompt(choice, __dirname);
      if (!prompt) {
        ctx.ui.notify(
          `No prompt template found for "${choice.template}" — expected ${choice.template}.md next to the extension`,
          "error",
        );
        return;
      }

      const finalPrompt = appendUserPrompt(prompt, args);
      ctx.ui.setEditorText(`${finalPrompt}\n\n`);
      ctx.ui.notify(
        "Wayfinder prompt added to editor. Add any extra context, then press Enter to run.",
        "info",
      );
    },
  });
}
