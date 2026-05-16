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

  const timestamp = new Date().toISOString().slice(0, 16).replace("T", "T") + "Z";

  return readFileSync(templatePath, "utf8")
    .replace(/\{\{issue_path\}\}/g, issue.path)
    .replace(/\{\{timestamp\}\}/g, timestamp);
}

function appendUserPrompt(basePrompt: string, userPrompt?: string): string {
  const extra = userPrompt?.trim();
  if (!extra) return basePrompt;

  return `${basePrompt}\n\n## Additional instructions from user\n${extra}`;
}

// ─── extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("issue", {
    description: "Pick an open issue and prepare the prompt in the editor",
    handler: async (args, ctx) => {
      const root = await getRepoRoot(pi, ctx.cwd);
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

      const prompt = buildPrompt(issue, __dirname);
      if (!prompt) {
        ctx.ui.notify(
          `No prompt template found for status "${issue.status}" — expected ${issue.status}.md next to the extension`,
          "error",
        );
        return;
      }

      const finalPrompt = appendUserPrompt(prompt, args);
      ctx.ui.setEditorText(`${finalPrompt}\n\n`);
      ctx.ui.notify(
        "Issue prompt added to editor. Add any extra context, then press Enter to run.",
        "info",
      );
    },
  });
}
