import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

// ─── types ────────────────────────────────────────────────────────────────────

interface Issue {
  path: string;
  feature: string;
  slug: string;
  status: string;
  label: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

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

async function getRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    timeout: 5_000,
  });
  return result.code === 0 ? result.stdout.trim() : cwd;
}

function findIssues(root: string): Issue[] {
  const scratchDir = join(root, ".scratch");
  if (!existsSync(scratchDir)) return [];

  const issues: Issue[] = [];

  for (const feature of readdirSync(scratchDir, { withFileTypes: true })) {
    if (!feature.isDirectory()) continue;

    const issuesDir = join(scratchDir, feature.name, "issues");
    if (!existsSync(issuesDir)) continue;

    for (const file of readdirSync(issuesDir)) {
      if (!file.endsWith(".md")) continue;

      const filePath = join(issuesDir, file);
      const content = readFileSync(filePath, "utf8");
      const frontmatter = parseFrontmatter(content);
      const status = frontmatter.status ?? "needs-plan";

      if (status === "done") continue;

      const slug = basename(file, ".md");
      issues.push({
        path: filePath,
        feature: feature.name,
        slug,
        status,
        label: `${feature.name} / [${status}] ${slug}`,
      });
    }
  }

  return issues;
}

function buildPrompt(issue: Issue, promptDir: string): string | null {
  const templatePath = join(promptDir, `${issue.status}.md`);
  if (!existsSync(templatePath)) return null;

  const timestamp = new Date().toISOString().slice(0, 16) + "Z";

  return readFileSync(templatePath, "utf8")
    .replace(/\{\{issue_path\}\}/g, issue.path)
    .replace(/\{\{timestamp\}\}/g, timestamp);
}

// ─── goal loop state ──────────────────────────────────────────────────────────

// "working"  — monitoring context usage
// "aborting" — abort() issued, waiting for the run to settle before prompting
// "handoff"  — handoff prompt sent, waiting for it to finish before resuming
type Phase = "idle" | "working" | "aborting" | "handoff";

// ctx from the /goal command handler (or the withSession replacement ctx on
// subsequent iterations). Only ExtensionCommandContext and ReplacedSessionContext
// have newSession() — ExtensionContext from event handlers does not.
let storedCtx: any = null;
let currentIssuePath: string | null = null;
let phase: Phase = "idle";

const HANDOFF_PROMPT =
  "Context limit reached for this goal session — implementation work has been stopped.\n\n" +
  "Invoke the `issue-handoff` skill now: write a handoff entry to the issue file you were " +
  "working on, keep its status as `in-progress`, then stop. Do not resume implementation. " +
  "A fresh session will pick the issue back up automatically.";

// ─── extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("goal", {
    description: "Pick an open issue and drive the full plan→implement loop with auto-handoff",
    handler: async (args: string, ctx: any) => {
      const root = await getRepoRoot(pi, ctx.cwd);

      let issuePath: string;

      if (args?.trim()) {
        issuePath = args.trim();
        if (!existsSync(issuePath)) {
          ctx.ui.notify(`Issue not found: ${issuePath}`, "error");
          return;
        }
      } else {
        const issues = findIssues(root);
        if (issues.length === 0) {
          ctx.ui.notify("No open issues found in .scratch/", "info");
          return;
        }

        const labels = issues.map((i) => i.label);
        const selected = await ctx.ui.select("Select an issue to work on:", labels);
        if (!selected) return;

        const issue = issues.find((i) => i.label === selected);
        if (!issue) return;
        issuePath = issue.path;
      }

      const content = readFileSync(issuePath, "utf8");
      const frontmatter = parseFrontmatter(content);
      const status = frontmatter.status ?? "needs-plan";

      if (status === "done") {
        ctx.ui.notify("This issue is already done.", "info");
        return;
      }

      const issue: Issue = {
        path: issuePath,
        feature: "",
        slug: basename(issuePath, ".md"),
        status,
        label: "",
      };

      const prompt = buildPrompt(issue, __dirname);
      if (!prompt) {
        ctx.ui.notify(`No template found for status "${status}"`, "error");
        return;
      }

      storedCtx = ctx;
      currentIssuePath = issuePath;
      phase = "working";

      ctx.ui.setEditorText(`${prompt}\n\n`);
      ctx.ui.notify("Goal prompt ready. Add any extra context, then press Enter to start.", "info");
    },
  });

  // Hard-stop the run when context approaches the limit. The handoff prompt is
  // deliberately not steered into the live turn — the agent is aborted first so it
  // cannot keep implementing, then prompted from a clean idle state below.
  pi.on("turn_end", (_event: any, ctx: any) => {
    if (phase !== "working" || !currentIssuePath) return;

    const usage = ctx.getContextUsage();
    if (!usage || usage.tokens === null) return;

    const threshold = Math.min((usage.contextWindow ?? 200_000) * 0.5, 100_000);
    if (usage.tokens < threshold) return;

    phase = "aborting";
    ctx.abort();
    ctx.ui.notify("Context limit reached — stopping work to write a handoff.", "info");
  });

  // Drives the two post-abort steps: prompt for the handoff, then start the
  // successor session once the handoff run has settled.
  pi.on("agent_settled", async (_event: any, _ctx: any) => {
    if (phase === "aborting") {
      phase = "handoff";
      setTimeout(() => pi.sendUserMessage(HANDOFF_PROMPT), 0);
      return;
    }

    if (phase !== "handoff" || !storedCtx || !currentIssuePath) return;

    const issuePath = currentIssuePath;
    const savedCtx = storedCtx;

    phase = "idle";
    storedCtx = null;
    currentIssuePath = null;

    let resumePrompt: string | null = null;
    try {
      const content = readFileSync(issuePath, "utf8");
      const frontmatter = parseFrontmatter(content);
      const status = frontmatter.status ?? "in-progress";
      const issue: Issue = { path: issuePath, feature: "", slug: basename(issuePath, ".md"), status, label: "" };
      resumePrompt = buildPrompt(issue, __dirname);
    } catch {
      // fall through to generic message
    }

    const resumeMsg =
      resumePrompt ??
      `Resume the goal for issue: ${issuePath}\nRead the issue file and the latest handoff entry, then continue.`;

    setTimeout(() => {
      savedCtx.newSession({
        withSession: async (newCtx: any) => {
          // Re-arm monitoring for the new session.
          // newCtx (ReplacedSessionContext) is stored so the next handoff can call newSession() again.
          currentIssuePath = issuePath;
          phase = "working";
          storedCtx = newCtx;
          newCtx.sendUserMessage(resumeMsg);
        },
      }).catch((err: unknown) => {
        try { savedCtx.ui.notify(`Goal auto-resume failed: ${String(err)}`, "error"); } catch {}
      });
    }, 0);
  });
}
