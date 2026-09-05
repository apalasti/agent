import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

// ─── types ────────────────────────────────────────────────────────────────────

interface Issue {
  path: string;
  feature: string;
  slug: string;
  number: string;
  title: string;
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
        number: slug.match(/^(\d+)/)?.[1] ?? "",
        title: content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug,
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

function buildOrchestratorPrompt(batch: Issue[], promptDir: string): string {
  const list = batch
    .map((i) => `- ${i.number} — ${i.title} — status: ${i.status} — \`${i.path}\``)
    .join("\n");

  return readFileSync(join(promptDir, "orchestrate.md"), "utf8")
    .replace(/\{\{issues\}\}/g, list)
    .replace(/\{\{plan_prompt_path\}\}/g, join(promptDir, "plan-auto.md"))
    .replace(/\{\{implement_prompt_path\}\}/g, join(promptDir, "ready-to-implement.md"))
    .replace(/\{\{in_progress_prompt_path\}\}/g, join(promptDir, "in-progress.md"));
}

function parseNumbers(args: string): string[] {
  return args
    .split(/[\s,]+/)
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => n.padStart(2, "0"));
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

  pi.registerCommand("orchestrate", {
    description: "Run a batch of issues unattended: /orchestrate 01 03 04",
    handler: async (args, ctx) => {
      const root = await getRepoRoot(pi, ctx.cwd);
      const issues = findIssues(root);

      if (issues.length === 0) {
        ctx.ui.notify("No open issues found in .scratch/", "info");
        return;
      }

      const features = [...new Set(issues.map((i) => i.feature))];
      const feature =
        features.length === 1
          ? features[0]
          : await ctx.ui.select("Which feature?", features);
      if (!feature) return;

      const candidates = issues
        .filter((i) => i.feature === feature)
        .sort((a, b) => a.number.localeCompare(b.number));

      const raw =
        args?.trim() ||
        (await ctx.ui.input(
          `Which issues, in order? (open: ${candidates.map((i) => i.number).join(", ")})`,
          candidates.map((i) => i.number).join(" "),
        ));
      if (!raw?.trim()) return;

      const batch: Issue[] = [];
      for (const number of parseNumbers(raw)) {
        const issue = candidates.find((i) => i.number === number);
        if (!issue) {
          ctx.ui.notify(`No open issue ${number} in ${feature}`, "error");
          return;
        }
        batch.push(issue);
      }

      ctx.ui.setEditorText(`${buildOrchestratorPrompt(batch, __dirname)}\n\n`);
      ctx.ui.notify(
        `Batch of ${batch.length} ready. Press Enter to run.`,
        "info",
      );
    },
  });
}
