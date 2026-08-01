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

// ctx from the /goal command handler (or the withSession replacement ctx on
// subsequent iterations). Only ExtensionCommandContext and ReplacedSessionContext
// have newSession() — ExtensionContext from event handlers does not.
let storedCtx: any = null;
let currentIssuePath: string | null = null;
let handoffPending = false;

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
      handoffPending = false;

      ctx.ui.setEditorText(`${prompt}\n\n`);
      ctx.ui.notify("Goal prompt ready. Add any extra context, then press Enter to start.", "info");
    },
  });

  // Steer the model to write a handoff entry when context approaches the limit.
  pi.on("turn_end", (_event: any, ctx: any) => {
    if (handoffPending || !currentIssuePath) return;

    const usage = ctx.getContextUsage();
    if (!usage || usage.tokens === null) return;

    const threshold = Math.min((usage.contextWindow ?? 200_000) * 0.5, 100_000);
    if (usage.tokens >= threshold) {
      handoffPending = true;
      pi.sendUserMessage(
        "⚠️ Context limit reached for this goal session. " +
          "Stop all implementation work immediately. " +
          "Invoke the `issue-handoff` skill to write a handoff entry to the current issue file " +
          "and update the status to `in-progress`, then stop. " +
          "A fresh session will resume automatically.",
        { deliverAs: "steer" },
      );
    }
  });

  // After the model writes the handoff, switch to a new session and auto-resume.
  // Must use withSession + newCtx.sendUserMessage — after newSession(), the old pi
  // reference is stale for all extensions. Deferred so agent_end returns first.
  pi.on("agent_end", async (_event: any, _ctx: any) => {
    if (!handoffPending || !storedCtx || !currentIssuePath) return;

    const issuePath = currentIssuePath;
    const savedCtx = storedCtx;

    handoffPending = false;
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
          // newCtx (ReplacedSessionContext) is stored so agent_end can call newSession() again.
          currentIssuePath = issuePath;
          handoffPending = false;
          storedCtx = newCtx;
          newCtx.sendUserMessage(resumeMsg);
        },
      }).catch((err: unknown) => {
        try { savedCtx.ui.notify(`Goal auto-resume failed: ${String(err)}`, "error"); } catch {}
      });
    }, 0);
  });
}
