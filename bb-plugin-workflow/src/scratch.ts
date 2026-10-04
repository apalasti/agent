import { numberOf, parseBlockedBy, parseFrontmatter, parseTitle } from "./markdown";

export interface ScratchTicket {
  kind: "ticket";
  effort: string;
  number: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  claimed: string | null;
  blocked: boolean;
  /** The workflow thread working on this ticket, when one claimed it. Set by the server scan, not the file. */
  thread?: { id: string; title: string | null } | null;
  /** Repo-absolute path of the ticket file. */
  path: string;
}

export interface ScratchIssue {
  kind: "issue";
  feature: string;
  number: string;
  slug: string;
  title: string;
  status: string;
  path: string;
}

export interface ScratchEffort {
  slug: string;
  mapPath: string;
  tickets: ScratchTicket[];
}

export interface ScratchFeature {
  slug: string;
  issues: ScratchIssue[];
}

export interface WorkbenchIndex {
  efforts: ScratchEffort[];
  features: ScratchFeature[];
  blockedTicketCount: number;
}

/**
 * Filesystem access the scanner needs, so it stays testable and host-agnostic.
 * Paths handed in and returned are absolute; `entries` yields paths under `dir`.
 */
export interface ScratchIo {
  /** Recursive file paths under `dir`; null when the directory does not exist. */
  entries(dir: string): Promise<string[] | null>;
  read(path: string): Promise<string>;
}

function basename(path: string, stripExt?: ".md"): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return stripExt !== undefined && name.endsWith(stripExt)
    ? name.slice(0, -stripExt.length)
    : name;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export async function scanScratch(root: string, io: ScratchIo): Promise<WorkbenchIndex> {
  const scratchDir = `${root}/.scratch`;
  const files = (await io.entries(scratchDir)) ?? [];
  const markdown = files.filter((f) => f.endsWith(".md"));

  const slugs = new Set<string>();
  for (const file of markdown) {
    const rel = file.slice(scratchDir.length + 1);
    const top = rel.split("/")[0];
    if (top) slugs.add(top);
  }

  const efforts: ScratchEffort[] = [];
  const features: ScratchFeature[] = [];
  let blockedTicketCount = 0;

  for (const slug of [...slugs].sort()) {
    const hasMap = markdown.includes(`${scratchDir}/${slug}/MAP.md`);
    const ticketPaths = markdown.filter(
      (f) => dirname(f) === `${scratchDir}/${slug}/tickets`,
    );
    const issuePaths = markdown.filter(
      (f) => dirname(f) === `${scratchDir}/${slug}/issues`,
    );

    if (hasMap) {
      const raw = await Promise.all(
        ticketPaths.sort().map(async (path) => {
          const content = await io.read(path);
          const frontmatter = parseFrontmatter(content);
          const fileSlug = basename(path, ".md");
          return {
            kind: "ticket" as const,
            effort: slug,
            number: numberOf(fileSlug),
            slug: fileSlug,
            title: parseTitle(content, fileSlug),
            type: frontmatter.type ?? "grilling",
            status: frontmatter.status ?? "open",
            claimed: frontmatter.claimed || null,
            blockedBy: parseBlockedBy(frontmatter["blocked-by"]),
            path,
          };
        }),
      );
      const byNumber = new Map(raw.map((t) => [t.number, t]));
      const tickets: ScratchTicket[] = raw.map(({ blockedBy, ...rest }) => ({
        ...rest,
        blocked: blockedBy.some((n) => byNumber.get(n)?.status !== "closed"),
      }));
      blockedTicketCount += tickets.filter((t) => t.status !== "closed" && t.blocked).length;
      efforts.push({ slug, mapPath: `${scratchDir}/${slug}/MAP.md`, tickets });
    }

    if (issuePaths.length > 0) {
      const issues = await Promise.all(
        issuePaths.sort().map(async (path) => {
          const content = await io.read(path);
          const frontmatter = parseFrontmatter(content);
          const fileSlug = basename(path, ".md");
          return {
            kind: "issue" as const,
            feature: slug,
            number: numberOf(fileSlug),
            slug: fileSlug,
            title: parseTitle(content, fileSlug),
            status: frontmatter.status ?? "needs-plan",
            path,
          };
        }),
      );
      features.push({ slug, issues });
    }
  }

  return { efforts, features, blockedTicketCount };
}

export type ResolvedRef =
  | { kind: "ticket"; ticket: ScratchTicket; effort: ScratchEffort }
  | { kind: "issue"; issue: ScratchIssue; feature: ScratchFeature };

/**
 * Refs are `<slug>/<NN>`, or the qualified `<slug>/tickets/<NN>` /
 * `<slug>/issues/<NN>` when a slug holds both kinds with the same number.
 */
export function resolveRef(index: WorkbenchIndex, ref: string): ResolvedRef {
  const parts = ref.split("/").filter(Boolean);
  const pad = (n: string) => n.padStart(2, "0");

  if (parts.length === 3 && (parts[1] === "tickets" || parts[1] === "issues")) {
    const [slug, sub, rawNumber] = parts;
    const number = pad(rawNumber);
    if (sub === "tickets") {
      const effort = index.efforts.find((e) => e.slug === slug);
      const ticket = effort?.tickets.find((t) => t.number === number);
      if (effort && ticket) return { kind: "ticket", ticket, effort };
    } else {
      const feature = index.features.find((f) => f.slug === slug);
      const issue = feature?.issues.find((i) => i.number === number);
      if (feature && issue) return { kind: "issue", issue, feature };
    }
    throw new Error(`No ${sub === "tickets" ? "ticket" : "issue"} ${slug}/${number}`);
  }

  if (parts.length === 2) {
    const [slug, rawNumber] = parts;
    const number = pad(rawNumber);
    const effort = index.efforts.find((e) => e.slug === slug);
    const ticket = effort?.tickets.find((t) => t.number === number);
    const feature = index.features.find((f) => f.slug === slug);
    const issue = feature?.issues.find((i) => i.number === number);
    if (ticket && issue) {
      throw new Error(
        `${ref} names both a ticket and an issue; qualify it as ${slug}/tickets/${number} or ${slug}/issues/${number}`,
      );
    }
    if (effort && ticket) return { kind: "ticket", ticket, effort };
    if (feature && issue) return { kind: "issue", issue, feature };
    throw new Error(`Nothing named ${ref} in .scratch/`);
  }

  throw new Error(`Cannot parse ref "${ref}" — expected <slug>/<NN>`);
}
