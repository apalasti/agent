// bb-plugin-workflow — run wayfinder tickets and issue batches from a
// project's .scratch/ as BB threads. The pi extensions this replaces filled
// the editor with a composed prompt; here the plugin composes the same
// templates and spawns the thread directly.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  resolveRef,
  scanScratch,
  type ScratchIo,
  type ScratchIssue,
} from "./src/scratch";
import {
  renderChartPrompt,
  renderHandoffPrompt,
  renderOrchestratePrompt,
  renderTicketPrompt,
  type TemplateSource,
} from "./src/prompts";

const ticketSchema = z.object({
  kind: z.literal("ticket"),
  effort: z.string(),
  number: z.string(),
  slug: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  claimed: z.string().nullable(),
  blocked: z.boolean(),
  path: z.string(),
});
const issueSchema = z.object({
  kind: z.literal("issue"),
  feature: z.string(),
  number: z.string(),
  slug: z.string(),
  title: z.string(),
  status: z.string(),
  path: z.string(),
});
const indexSchema = z.object({
  efforts: z.array(
    z.object({ slug: z.string(), mapPath: z.string(), tickets: z.array(ticketSchema) }),
  ),
  features: z.array(z.object({ slug: z.string(), issues: z.array(issueSchema) })),
  blockedTicketCount: z.number(),
});

const spawnInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ref"), projectId: z.string().min(1), ref: z.string().min(1) }),
  z.object({
    kind: z.literal("chart"),
    projectId: z.string().min(1),
    idea: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("orchestrate"),
    projectId: z.string().min(1),
    feature: z.string().min(1),
    numbers: z.array(z.string().min(1)).min(1),
  }),
]);

export const rpcContract = defineRpcContract({
  projects: {
    input: z.null(),
    output: z.object({ projects: z.array(z.object({ id: z.string(), name: z.string() })) }),
  },
  scan: {
    input: z.object({ projectId: z.string().min(1) }),
    output: z.object({ index: indexSchema }),
  },
  spawn: {
    input: spawnInputSchema,
    output: z.object({ threadId: z.string(), title: z.string() }),
  },
});

interface ProjectRoot {
  path: string;
  hostId: string | undefined;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    spawnInProjectDefault: {
      type: "boolean",
      label: "Spawn threads in the project default environment",
      description:
        "Off (default): threads run unmanaged in the project's source checkout, so untracked .scratch/ files are visible. On: use the environment the project is configured with.",
      default: false,
    },
  });
  const { spawnInProjectDefault } = await settings.get();

  const templatesDir = (() => {
    // The path-loaded server.ts sits beside templates/; the built
    // dist/server.js one level deeper. Probe for a required template: the
    // directory name alone is not distinctive enough to trust.
    for (const rel of ["./templates", "../templates"]) {
      const dir = fileURLToPath(new URL(rel, import.meta.url));
      if (existsSync(`${dir}/chart.md`)) return dir;
    }
    throw new Error("workflow plugin templates directory not found");
  })();
  const templates: TemplateSource = {
    get: (name) => {
      const path = `${templatesDir}/${name}.md`;
      return existsSync(path) ? readFileSync(path, "utf8") : null;
    },
  };

  async function projectRoot(projectId: string): Promise<ProjectRoot> {
    const project = (await bb.sdk.projects.get({ projectId })) as {
      sources?: { path?: string | null; targetPath?: string | null; hostId?: string; isDefault?: boolean }[];
    };
    const sources = project.sources ?? [];
    const source = sources.find((s) => s.isDefault === true) ?? sources[0];
    const path = source?.path ?? source?.targetPath;
    if (!source || !path) throw new Error(`Project ${projectId} has no local source path`);
    return { path, hostId: source.hostId };
  }

  function hostIo(hostId: string | undefined): ScratchIo {
    return {
      entries: async (dir) => {
        try {
          const res = await bb.sdk.files.listPaths({
            hostId,
            path: dir,
            includeFiles: true,
            includeDirectories: false,
          });
          return res.paths.map((entry) => `${dir}/${entry.path}`);
        } catch {
          return null;
        }
      },
      read: async (path) => (await bb.sdk.files.read({ hostId, path })).content,
    };
  }

  async function scanProject(projectId: string) {
    const root = await projectRoot(projectId);
    return scanScratch(root.path, hostIo(root.hostId));
  }

  function timestamp(): string {
    return `${new Date().toISOString().slice(0, 16)}Z`;
  }

  async function spawnThread(args: {
    projectId: string;
    title: string;
    prompt: string;
    metadata: Record<string, string>;
    root: ProjectRoot;
  }): Promise<{ threadId: string; title: string }> {
    const environment = spawnInProjectDefault
      ? ({ type: "project-default" } as const)
      : ({
          type: "host",
          hostId: args.root.hostId,
          workspace: { type: "unmanaged", path: args.root.path },
        } as const);
    const thread = await bb.sdk.threads.spawn({
      projectId: args.projectId,
      environment,
      prompt: args.prompt,
      title: args.title,
      pluginMetadata: args.metadata,
    });
    // Best-effort: brings the thread into view in connected apps.
    await bb.sdk.threads.open({ threadId: thread.id, file: null }).catch(() => undefined);
    return { threadId: thread.id, title: args.title };
  }

  async function spawnFromInput(
    input: z.infer<typeof spawnInputSchema>,
  ): Promise<{ threadId: string; title: string }> {
    const root = await projectRoot(input.projectId);
    const index = await scanScratch(root.path, hostIo(root.hostId));

    if (input.kind === "chart") {
      const prompt = renderChartPrompt(templates, input.idea, `${root.path}/.scratch`);
      if (prompt === null) throw new Error("chart.md template missing from the plugin");
      const title = `Chart: ${input.idea.length > 60 ? `${input.idea.slice(0, 60)}…` : input.idea}`;
      return spawnThread({
        projectId: input.projectId,
        title,
        prompt,
        metadata: { kind: "chart", idea: input.idea },
        root,
      });
    }

    if (input.kind === "orchestrate") {
      const feature = index.features.find((f) => f.slug === input.feature);
      if (!feature) throw new Error(`No issues under .scratch/${input.feature}/issues/`);
      const batch: ScratchIssue[] = [];
      for (const raw of input.numbers) {
        const number = raw.padStart(2, "0");
        const issue = feature.issues.find((i) => i.number === number);
        if (!issue) throw new Error(`No issue ${number} in ${input.feature}`);
        if (issue.status === "done") throw new Error(`Issue ${number} in ${input.feature} is done`);
        batch.push(issue);
      }
      const prompt = renderOrchestratePrompt(templates, batch);
      if (prompt === null) throw new Error("orchestrate.md template missing from the plugin");
      const title = `Orchestrate ${input.feature}: ${batch.map((i) => i.number).join(", ")}`;
      return spawnThread({
        projectId: input.projectId,
        title,
        prompt,
        metadata: { kind: "orchestrate", feature: input.feature, issues: batch.map((i) => i.number).join(",") },
        root,
      });
    }

    if (input.ref.endsWith("/handoff")) {
      const slug = input.ref.slice(0, -"/handoff".length);
      const effort = index.efforts.find((e) => e.slug === slug);
      if (!effort) throw new Error(`No effort named ${slug}`);
      const prompt = renderHandoffPrompt(templates, effort, `${root.path}/.scratch/${slug}`, timestamp());
      if (prompt === null) throw new Error("handoff.md template missing from the plugin");
      return spawnThread({
        projectId: input.projectId,
        title: `Hand off ${slug}`,
        prompt,
        metadata: { kind: "handoff", effort: slug },
        root,
      });
    }

    const resolved = resolveRef(index, input.ref);
    if (resolved.kind === "ticket") {
      const { effort, ticket } = resolved;
      const prompt = renderTicketPrompt(
        templates,
        effort,
        `${root.path}/.scratch/${effort.slug}`,
        ticket,
        timestamp(),
      );
      if (prompt === null) throw new Error(`No prompt template for ticket type "${ticket.type}"`);
      return spawnThread({
        projectId: input.projectId,
        title: `${effort.slug}/${ticket.number}: ${ticket.title}`,
        prompt,
        metadata: { kind: "ticket", effort: effort.slug, ticket: ticket.slug },
        root,
      });
    }

    // A single issue runs as an orchestrate batch of one, as /orchestrate did.
    const { feature, issue } = resolved;
    const prompt = renderOrchestratePrompt(templates, [issue]);
    if (prompt === null) throw new Error("orchestrate.md template missing from the plugin");
    return spawnThread({
      projectId: input.projectId,
      title: `Orchestrate ${feature.slug}: ${issue.number}`,
      prompt,
      metadata: { kind: "orchestrate", feature: feature.slug, issues: issue.number },
      root,
    });
  }

  const toError = (cause: unknown): Error =>
    cause instanceof Error ? cause : new Error(String(cause));

  bb.rpc.register(rpcContract, {
    projects: async () => {
      const projects = await bb.sdk.projects.list({ includePersonal: false });
      return { projects: projects.map((p) => ({ id: p.id, name: p.name })) };
    },
    scan: async ({ projectId }) => ({ index: await scanProject(projectId) }),
    spawn: (input) => spawnFromInput(input),
  });

  async function resolveProjectId(
    requested: string | undefined,
    ctxProjectId: string | undefined,
  ): Promise<string> {
    const projects = await bb.sdk.projects.list({ includePersonal: false });
    if (requested !== undefined) {
      const match = projects.find((p) => p.id === requested || p.name === requested);
      if (match) return match.id;
      throw new PluginCliError(`No project "${requested}"`, {
        code: "invalid_value",
        hint: `Projects: ${projects.map((p) => p.name).join(", ") || "none"}`,
      });
    }
    if (ctxProjectId !== undefined && projects.some((p) => p.id === ctxProjectId)) {
      return ctxProjectId;
    }
    if (projects.length === 1) return projects[0].id;
    throw new PluginCliError("Which project?", {
      code: "missing_required",
      hint: `Pass --project. Projects: ${projects.map((p) => p.name).join(", ") || "none"}`,
    });
  }

  const projectOption = {
    type: "string" as const,
    description: "Project id or name; defaults to the current thread's project",
  };
  const jsonOption = { type: "boolean" as const, description: "Emit machine-readable JSON" };

  const cliRun = async (
    fn: (projectId: string) => Promise<{ text: string; value: unknown }>,
    requested: string | undefined,
    ctxProjectId: string | undefined,
    json: boolean | undefined,
  ) => {
    const projectId = await resolveProjectId(requested, ctxProjectId);
    const { text, value } = await fn(projectId);
    return { exitCode: 0, stdout: json ? JSON.stringify(value) : text };
  };

  bb.cli.register(
    defineCli({
      name: "workflow",
      summary: "Run wayfinder tickets and issue batches from .scratch/ as BB threads",
      commands: {
        tickets: cliCommand({
          summary: "List frontier tickets (open and unblocked) across efforts",
          options: { project: projectOption, json: jsonOption },
          async run(input, ctx) {
            return cliRun(
              async (projectId) => {
                const index = await scanProject(projectId);
                const frontier = index.efforts.flatMap((e) =>
                  e.tickets.filter((t) => t.status !== "closed" && !t.blocked),
                );
                const lines = frontier.map(
                  (t) =>
                    `${t.effort}/${t.number}  [${t.type}] ${t.title}${t.claimed ? `  (claimed ${t.claimed})` : ""}`,
                );
                if (index.blockedTicketCount > 0) {
                  lines.push(`(${index.blockedTicketCount} blocked, hidden)`);
                }
                return {
                  text: lines.length === 0 ? "No frontier tickets." : lines.join("\n"),
                  value: { tickets: frontier, blockedTicketCount: index.blockedTicketCount },
                };
              },
              input.options.project,
              ctx.projectId,
              input.options.json,
            );
          },
        }),
        issues: cliCommand({
          summary: "List open issues grouped by feature",
          options: { project: projectOption, json: jsonOption },
          async run(input, ctx) {
            return cliRun(
              async (projectId) => {
                const index = await scanProject(projectId);
                const open = index.features
                  .map((f) => ({ ...f, issues: f.issues.filter((i) => i.status !== "done") }))
                  .filter((f) => f.issues.length > 0);
                const lines = open.flatMap((f) =>
                  f.issues.map((i) => `${f.slug}/${i.number}  ${i.status}  ${i.title}`),
                );
                return {
                  text: lines.length === 0 ? "No open issues." : lines.join("\n"),
                  value: { features: open },
                };
              },
              input.options.project,
              ctx.projectId,
              input.options.json,
            );
          },
        }),
        run: cliCommand({
          summary: "Spawn a thread for one ticket or issue",
          description:
            "Ref grammar: <slug>/<NN>, qualified as <slug>/tickets/<NN> or <slug>/issues/<NN> on collision; <slug>/handoff hands a finished map off to to-prd.",
          positionals: [
            { name: "ref", description: "Ticket or issue ref, or <slug>/handoff", required: true },
          ],
          options: { project: projectOption, json: jsonOption },
          async run(input, ctx) {
            return cliRun(
              async (projectId) => {
                const spawned = await spawnFromInput({
                  kind: "ref",
                  projectId,
                  ref: input.positionals.ref,
                }).catch((cause) => {
                  throw new PluginCliError(toError(cause).message, { code: "invalid_value" });
                });
                return {
                  text: `Spawned ${spawned.threadId}: ${spawned.title}`,
                  value: spawned,
                };
              },
              input.options.project,
              ctx.projectId,
              input.options.json,
            );
          },
        }),
        chart: cliCommand({
          summary: "Chart a new wayfinder map from a loose idea",
          positionals: [{ name: "idea", description: "One or two lines", required: true }],
          options: { project: projectOption, json: jsonOption },
          async run(input, ctx) {
            return cliRun(
              async (projectId) => {
                const spawned = await spawnFromInput({
                  kind: "chart",
                  projectId,
                  idea: input.positionals.idea,
                });
                return { text: `Spawned ${spawned.threadId}: ${spawned.title}`, value: spawned };
              },
              input.options.project,
              ctx.projectId,
              input.options.json,
            );
          },
        }),
        orchestrate: cliCommand({
          summary: "Run a batch of open issues in one orchestrator thread",
          description: 'Example: bb workflow orchestrate dark-mode "01 03 04"',
          positionals: [
            { name: "feature", description: "The .scratch/<feature>/ directory", required: true },
            { name: "numbers", description: "Issue numbers, space or comma separated", required: true },
          ],
          options: { project: projectOption, json: jsonOption },
          async run(input, ctx) {
            return cliRun(
              async (projectId) => {
                const numbers = input.positionals.numbers
                  .split(/[\s,]+/)
                  .map((n) => n.trim())
                  .filter(Boolean);
                const spawned = await spawnFromInput({
                  kind: "orchestrate",
                  projectId,
                  feature: input.positionals.feature,
                  numbers,
                }).catch((cause) => {
                  throw new PluginCliError(toError(cause).message, { code: "invalid_value" });
                });
                return {
                  text: `Spawned ${spawned.threadId}: ${spawned.title}`,
                  value: spawned,
                };
              },
              input.options.project,
              ctx.projectId,
              input.options.json,
            );
          },
        }),
      },
    }),
  );
}
