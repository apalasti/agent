// bb-plugin-workflow — run wayfinder tickets and issue batches from a
// project's .scratch/ as BB threads, scoped per worktree. The pi extensions
// this replaces filled the editor with a composed prompt; here the plugin
// composes the same templates and spawns the thread directly, targeted at the
// checkout the ticket lives in. BB's own sidebar groups the spawned threads
// under their worktree environment.
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
  type WorkbenchIndex,
} from "./src/scratch";
import {
  renderChartPrompt,
  renderHandoffPrompt,
  renderOrchestratePrompt,
  renderTicketPrompt,
  type TemplateSource,
} from "./src/prompts";
import {
  discoverGitWorktrees,
  findWorktree,
  mergeWorktrees,
  type WorktreeInfo,
} from "./src/worktrees";

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
const worktreeSchema = z.object({
  path: z.string(),
  hostId: z.string().optional(),
  branch: z.string().nullable(),
  isPrimary: z.boolean(),
  isWorktree: z.boolean(),
  environmentId: z.string().nullable(),
});
export type WorkflowWorktree = z.infer<typeof worktreeSchema>;

const sectionSchema = z.object({
  worktree: worktreeSchema,
  index: indexSchema.nullable(),
});
export type WorkflowSection = z.infer<typeof sectionSchema>;

const targetSchema = z.object({
  path: z.string().min(1),
  hostId: z.string().optional(),
  environmentId: z.string().nullish(),
});

const spawnInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ref"),
    projectId: z.string().min(1),
    ref: z.string().min(1),
    target: targetSchema.optional(),
  }),
  z.object({
    kind: z.literal("chart"),
    projectId: z.string().min(1),
    idea: z.string().trim().min(1),
    target: targetSchema.optional(),
  }),
  z.object({
    kind: z.literal("orchestrate"),
    projectId: z.string().min(1),
    feature: z.string().min(1),
    numbers: z.array(z.string().min(1)).min(1),
    target: targetSchema.optional(),
  }),
]);

const rowStatusSchema = z.object({
  icon: z.string(),
  label: z.string(),
  tone: z.enum(["default", "error", "running", "success"]).optional(),
});

export const rpcContract = defineRpcContract({
  projects: {
    input: z.null(),
    output: z.object({ projects: z.array(z.object({ id: z.string(), name: z.string() })) }),
  },
  scan: {
    input: z.object({ projectId: z.string().min(1) }),
    output: z.object({ sections: z.array(sectionSchema) }),
  },
  scanThread: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({
      threadId: z.string(),
      projectId: z.string(),
      section: sectionSchema.nullable(),
    }),
  },
  spawn: {
    input: spawnInputSchema,
    output: z.object({ threadId: z.string(), title: z.string() }),
  },
  spawnHere: {
    input: z.object({
      projectId: z.string().min(1),
      prompt: z.string().trim().min(1),
      title: z.string().trim().min(1).max(120).optional(),
      target: targetSchema,
    }),
    output: z.object({ threadId: z.string(), title: z.string() }),
  },
  rowStatuses: {
    input: z.null(),
    output: z.object({ statuses: z.record(z.string(), rowStatusSchema) }),
  },
});

interface SpawnTarget {
  path: string;
  hostId?: string;
  environmentId?: string | null;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    spawnInProjectDefault: {
      type: "boolean",
      label: "Spawn threads in the project default environment",
      description:
        "Off (default): threads run unmanaged in the checkout that owns the ticket, so untracked .scratch/ files are visible. On: applies only where no worktree context exists (a bare CLI run), using the project's configured environment.",
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

  // Environment provider so the compose screen's own Environment picker can
  // attach a path that already exists on the machine (a git worktree, any
  // checkout). experimental_existingPath makes core reuse the environment
  // recorded for a path, so second threads in the same worktree share it.
  bb.experimental_environments.register({
    id: "existing-checkout",
    displayName: "Existing checkout",
    description:
      "Work in a path that already exists on the machine (a git worktree, any checkout).",
    icon: "FolderGit2",
    inputs: z.object({ path: z.string().trim().min(1).describe("Absolute path of the checkout") }),
    experimental_existingPath: (inputs) => inputs.path,
    availability: () => ({ status: "available" }),
    validate: async ({ host, inputs }) => {
      const readable = await bb.sdk.files
        .listPaths({ hostId: host.id, path: inputs.path, includeFiles: true, includeDirectories: true })
        .then(() => true)
        .catch(() => false);
      return readable
        ? { action: "accept" }
        : { action: "refuse", message: "Path does not exist or is not readable on this machine" };
    },
    create: async ({ host, inputs, report }) => {
      report.step("Attaching existing checkout");
      const readable = await bb.sdk.files
        .listPaths({ hostId: host.id, path: inputs.path, includeFiles: true, includeDirectories: true })
        .then(() => true)
        .catch(() => false);
      if (!readable) {
        return { status: "failed", message: "Path does not exist or is not readable" };
      }
      return { status: "created", path: inputs.path, ownsPath: false };
    },
    remove: async () => ({ status: "removed" }),
  });

  async function listProjectWorktrees(projectId: string): Promise<WorktreeInfo[]> {
    const project = (await bb.sdk.projects.get({ projectId })) as {
      sources?: { path?: string | null; targetPath?: string | null; hostId?: string }[];
    };
    const sources: { path: string; hostId?: string }[] = [];
    for (const s of project.sources ?? []) {
      const path = s.path ?? s.targetPath ?? null;
      if (path !== null) sources.push({ path, hostId: s.hostId });
    }
    if (sources.length === 0) throw new Error(`Project ${projectId} has no local source path`);

    const { environments } = (await bb.sdk.environments.list({ projectId })) as {
      environments?: {
        id: string;
        path?: string | null;
        hostId?: string;
        branchName?: string | null;
        isWorktree?: boolean | null;
      }[];
    };
    const environmentRefs = (environments ?? [])
      .filter((e) => e.path)
      .map((e) => ({
        environmentId: e.id,
        path: e.path as string,
        hostId: e.hostId,
        branchName: e.branchName,
        isWorktree: e.isWorktree,
      }));

    const gitio = {
      list: async (path: string, hostId?: string) => {
        const res = await bb.sdk.files.listPaths({
          hostId,
          path,
          includeFiles: true,
          includeDirectories: false,
        });
        return res.paths.map((entry) => entry.path);
      },
      read: async (path: string, hostId?: string) =>
        (await bb.sdk.files.read({ hostId, path })).content,
    };
    const gitWorktrees = (
      await Promise.all(sources.map((source) => discoverGitWorktrees(gitio, source)))
    ).flat();

    return mergeWorktrees(sources, environmentRefs, gitWorktrees);
  }

  async function scanWorktree(worktree: WorktreeInfo): Promise<WorkbenchIndex | null> {
    return scanScratch(worktree.path, hostIo(worktree.hostId));
  }

  async function scanSections(
    projectId: string,
    worktrees?: WorktreeInfo[],
  ): Promise<WorkflowSection[]> {
    const selected = worktrees ?? (await listProjectWorktrees(projectId));
    return Promise.all(
      selected.map(async (worktree) => ({
        worktree,
        index: await scanWorktree(worktree).catch(() => null),
      })),
    );
  }

  function timestamp(): string {
    return `${new Date().toISOString().slice(0, 16)}Z`;
  }

  function environmentFor(target: SpawnTarget, explicit: boolean) {
    if (!explicit && spawnInProjectDefault) return { type: "project-default" as const };
    if (target.environmentId) {
      return { type: "reuse" as const, environmentId: target.environmentId };
    }
    return {
      type: "host" as const,
      hostId: target.hostId,
      workspace: { type: "unmanaged" as const, hostId: target.hostId, path: target.path },
    };
  }

  async function spawnThread(args: {
    projectId: string;
    title: string;
    prompt: string;
    metadata: Record<string, string>;
    target: SpawnTarget;
    explicit: boolean;
  }): Promise<{ threadId: string; title: string }> {
    const thread = await bb.sdk.threads.spawn({
      projectId: args.projectId,
      environment: environmentFor(args.target, args.explicit),
      prompt: args.prompt,
      title: args.title,
      pluginMetadata: { ...args.metadata, checkout: args.target.path },
    });
    // Best-effort: brings the thread into view in connected apps.
    await bb.sdk.threads.open({ threadId: thread.id, file: null }).catch(() => undefined);
    return { threadId: thread.id, title: args.title };
  }

  async function spawnFromInput(
    input: z.infer<typeof spawnInputSchema>,
  ): Promise<{ threadId: string; title: string }> {
    const worktrees = await listProjectWorktrees(input.projectId);
    const explicit = input.target !== undefined;
    const target: WorktreeInfo = explicit
      ? (() => {
          const requested = input.target!;
          const known = worktrees.find((w) => w.path === requested.path);
          return known ?? { path: requested.path, hostId: requested.hostId, environmentId: requested.environmentId ?? null, branch: null, isPrimary: false, isWorktree: false };
        })()
      : worktrees.find((w) => w.isPrimary) ?? worktrees[0];
    const index = await scanScratch(target.path, hostIo(target.hostId));
    const base = { projectId: input.projectId, target, explicit };
    const scratchRoot = `${target.path}/.scratch`;

    if (input.kind === "chart") {
      const prompt = renderChartPrompt(templates, input.idea, scratchRoot);
      if (prompt === null) throw new Error("chart.md template missing from the plugin");
      const title = `Chart: ${input.idea.length > 60 ? `${input.idea.slice(0, 60)}…` : input.idea}`;
      return spawnThread({ ...base, title, prompt, metadata: { kind: "chart", idea: input.idea } });
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
        ...base,
        title,
        prompt,
        metadata: {
          kind: "orchestrate",
          feature: input.feature,
          issues: batch.map((i) => i.number).join(","),
        },
      });
    }

    if (input.ref.endsWith("/handoff")) {
      const slug = input.ref.slice(0, -"/handoff".length);
      const effort = index.efforts.find((e) => e.slug === slug);
      if (!effort) throw new Error(`No effort named ${slug}`);
      const prompt = renderHandoffPrompt(templates, effort, `${scratchRoot}/${slug}`, timestamp());
      if (prompt === null) throw new Error("handoff.md template missing from the plugin");
      return spawnThread({
        ...base,
        title: `Hand off ${slug}`,
        prompt,
        metadata: { kind: "handoff", effort: slug },
      });
    }

    const resolved = resolveRef(index, input.ref);
    if (resolved.kind === "ticket") {
      const { effort, ticket } = resolved;
      const prompt = renderTicketPrompt(
        templates,
        effort,
        `${scratchRoot}/${effort.slug}`,
        ticket,
        timestamp(),
      );
      if (prompt === null) throw new Error(`No prompt template for ticket type "${ticket.type}"`);
      return spawnThread({
        ...base,
        title: `${effort.slug}/${ticket.number}: ${ticket.title}`,
        prompt,
        metadata: { kind: "ticket", effort: effort.slug, number: ticket.number, ticket: ticket.slug },
      });
    }

    // A single issue runs as an orchestrate batch of one, as /orchestrate did.
    const { feature, issue } = resolved;
    const prompt = renderOrchestratePrompt(templates, [issue]);
    if (prompt === null) throw new Error("orchestrate.md template missing from the plugin");
    return spawnThread({
      ...base,
      title: `Orchestrate ${feature.slug}: ${issue.number}`,
      prompt,
      metadata: { kind: "orchestrate", feature: feature.slug, issues: issue.number },
    });
  }

  async function sectionForThread(threadId: string): Promise<{
    threadId: string;
    projectId: string;
    section: WorkflowSection | null;
  }> {
    const thread = (await bb.sdk.threads.get({ threadId })) as {
      id: string;
      projectId: string;
      environmentId?: string | null;
    };
    if (!thread.environmentId) return { threadId, projectId: thread.projectId, section: null };
    const env = (await bb.sdk.environments.get({ environmentId: thread.environmentId })) as {
      id: string;
      path?: string | null;
      hostId?: string;
      branchName?: string | null;
      isWorktree?: boolean | null;
    };
    if (!env.path) return { threadId, projectId: thread.projectId, section: null };
    const known = await listProjectWorktrees(thread.projectId);
    const worktree: WorkflowWorktree = known.find((w) => w.path === env.path) ?? {
      path: env.path,
      hostId: env.hostId,
      branch: env.branchName ?? null,
      isPrimary: false,
      isWorktree: env.isWorktree ?? true,
      environmentId: env.id,
    };
    const [section] = await scanSections(thread.projectId, [
      { ...worktree, environmentId: worktree.environmentId ?? env.id },
    ]);
    return { threadId, projectId: thread.projectId, section };
  }

  async function rowStatuses(): Promise<Record<string, z.infer<typeof rowStatusSchema>>> {
    const threads = (await bb.sdk.threads.list({ originPluginId: bb.pluginId, limit: 200 })) as {
      id: string;
      projectId: string;
      status?: string;
      archivedAt?: number | string | null;
      deletedAt?: number | string | null;
    }[];
    const statuses: Record<string, z.infer<typeof rowStatusSchema>> = {};
    const sectionsByProject = new Map<string, WorkflowSection[]>();
    const sectionsFor = async (projectId: string): Promise<WorkflowSection[]> => {
      if (!sectionsByProject.has(projectId)) {
        sectionsByProject.set(projectId, await scanSections(projectId).catch(() => []));
      }
      return sectionsByProject.get(projectId)!;
    };
    for (const thread of threads) {
      const meta = (await bb.sdk.threads
        .getPluginMetadata({ threadId: thread.id })
        .catch(() => ({}))) as Record<string, string>;
      if (!meta.kind) continue;
      if (meta.kind === "chart") {
        statuses[thread.id] = {
          icon: "Map",
          label: `Charting: ${meta.idea && meta.idea.length > 40 ? `${meta.idea.slice(0, 40)}…` : meta.idea ?? ""}`,
        };
        continue;
      }
      if (meta.kind === "handoff") {
        statuses[thread.id] = { icon: "FileOutput", label: `Handoff: ${meta.effort}` };
        continue;
      }
      const checkout = meta.checkout;
      const sections = (await sectionsFor(thread.projectId)).filter(
        (s) => !checkout || s.worktree.path === checkout,
      );
      if (meta.kind === "ticket") {
        let matched: WorkbenchIndex["efforts"][number]["tickets"][number] | null = null;
        for (const section of sections) {
          for (const effort of section.index?.efforts ?? []) {
            if (effort.slug !== meta.effort) continue;
            const ticket = effort.tickets.find((t) => t.number === meta.number);
            if (ticket) matched = ticket;
          }
        }
        if (!matched) continue;
        const ref = `${meta.effort}/${meta.number}`;
        if (matched.status === "closed" || matched.status === "done") {
          statuses[thread.id] = { icon: "Check", label: `${ref} — done`, tone: "success" };
        } else if (matched.claimed) {
          statuses[thread.id] = { icon: "CircleDot", label: `${ref} — in progress`, tone: "running" };
        } else {
          statuses[thread.id] = { icon: "Ticket", label: `${ref} — open` };
        }
        continue;
      }
      if (meta.kind === "orchestrate") {
        const numbers = (meta.issues ?? "").split(",").filter(Boolean);
        const feature = sections
          .flatMap((s) => s.index?.features ?? [])
          .find((f) => f.slug === meta.feature);
        if (!feature || numbers.length === 0) continue;
        const issues = feature.issues.filter((i) => numbers.includes(i.number));
        const done = issues.filter((i) => i.status === "done").length;
        if (done === issues.length && issues.length > 0) {
          statuses[thread.id] = {
            icon: "ListChecks",
            label: `${meta.feature} — all ${issues.length} done`,
            tone: "success",
          };
        } else {
          statuses[thread.id] = {
            icon: "ListChecks",
            label: `${meta.feature} — ${done}/${issues.length} done`,
            tone: "running",
          };
        }
      }
    }
    return statuses;
  }

  const toError = (cause: unknown): Error =>
    cause instanceof Error ? cause : new Error(String(cause));

  bb.rpc.register(rpcContract, {
    projects: async () => {
      const projects = await bb.sdk.projects.list({ includePersonal: false });
      return { projects: projects.map((p) => ({ id: p.id, name: p.name })) };
    },
    scan: async ({ projectId }) => ({ sections: await scanSections(projectId) }),
    scanThread: ({ threadId }) => sectionForThread(threadId),
    spawn: (input) => spawnFromInput(input),
    spawnHere: async (input) => {
      const worktrees = await listProjectWorktrees(input.projectId);
      const known = worktrees.find((w) => w.path === input.target.path);
      const target: SpawnTarget = known ?? {
        path: input.target.path,
        hostId: input.target.hostId,
        environmentId: input.target.environmentId ?? null,
      };
      const title =
        input.title ??
        (input.prompt.length > 60 ? `${input.prompt.slice(0, 60)}…` : input.prompt);
      return spawnThread({
        projectId: input.projectId,
        title,
        prompt: input.prompt,
        metadata: { kind: "manual" },
        target,
        explicit: true,
      });
    },
    rowStatuses: async () => ({ statuses: await rowStatuses() }),
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

  async function selectWorktrees(
    projectId: string,
    query: string | undefined,
  ): Promise<WorktreeInfo[]> {
    const worktrees = await listProjectWorktrees(projectId);
    if (query === undefined) return worktrees;
    const match = findWorktree(worktrees, query);
    if (!match) {
      throw new PluginCliError(`No worktree matches "${query}"`, {
        code: "invalid_value",
        hint: `Checkouts: ${worktrees.map((w) => w.branch ?? w.path).join(", ") || "none"}`,
      });
    }
    return [match];
  }

  const projectOption = {
    type: "string" as const,
    description: "Project id or name; defaults to the current thread's project",
  };
  const worktreeOption = {
    type: "string" as const,
    description: "Worktree branch, directory name, or path; defaults to all worktrees",
  };
  const jsonOption = { type: "boolean" as const, description: "Emit machine-readable JSON" };

  interface CliContext {
    projectId?: string;
  }

  const runScoped = async (
    opts: { project?: string; worktree?: string; json?: boolean },
    ctx: CliContext,
    fn: (projectId: string, worktrees: WorktreeInfo[]) => Promise<{ text: string; value: unknown }>,
  ) => {
    const projectId = await resolveProjectId(opts.project, ctx.projectId);
    const worktrees = await selectWorktrees(projectId, opts.worktree);
    const { text, value } = await fn(projectId, worktrees);
    return { exitCode: 0, stdout: opts.json ? JSON.stringify(value) : text };
  };

  /** Explicit --worktree targets spawn in that checkout; bare runs fall through to the v1 default. */
  const explicitTarget = (selected: WorktreeInfo[], query: string | undefined) =>
    query === undefined ? undefined : toSpawnTarget(selected[0]);
  const toSpawnTarget = (w: WorktreeInfo): SpawnTarget => ({
    path: w.path,
    hostId: w.hostId,
    environmentId: w.environmentId,
  });

  bb.cli.register(
    defineCli({
      name: "workflow",
      summary: "Run wayfinder tickets and issue batches from .scratch/ as BB threads",
      commands: {
        tickets: cliCommand({
          summary: "List frontier tickets (open and unblocked) across efforts",
          options: { project: projectOption, worktree: worktreeOption, json: jsonOption },
          async run(input, ctx) {
            return runScoped(input.options, ctx, async (projectId, worktrees) => {
              const sections = await scanSections(projectId, worktrees);
              const lines: string[] = [];
              for (const { worktree, index } of sections) {
                const frontier =
                  index?.efforts.flatMap((e) =>
                    e.tickets.filter((t) => t.status !== "closed" && !t.blocked),
                  ) ?? [];
                if (frontier.length === 0 && (index?.blockedTicketCount ?? 0) === 0) continue;
                if (sections.length > 1) {
                  lines.push(`-- ${worktree.branch ?? worktree.path}`);
                }
                lines.push(
                  ...frontier.map(
                    (t) =>
                      `${t.effort}/${t.number}  [${t.type}] ${t.title}${t.claimed ? `  (claimed ${t.claimed})` : ""}`,
                  ),
                );
                if ((index?.blockedTicketCount ?? 0) > 0) {
                  lines.push(`(${index!.blockedTicketCount} blocked, hidden)`);
                }
              }
              const blockedTicketCount = sections.reduce(
                (n, s) => n + (s.index?.blockedTicketCount ?? 0),
                0,
              );
              return {
                text: lines.length === 0 ? "No frontier tickets." : lines.join("\n"),
                value: { sections, blockedTicketCount },
              };
            });
          },
        }),
        issues: cliCommand({
          summary: "List open issues grouped by feature",
          options: { project: projectOption, worktree: worktreeOption, json: jsonOption },
          async run(input, ctx) {
            return runScoped(input.options, ctx, async (projectId, worktrees) => {
              const sections = await scanSections(projectId, worktrees);
              const lines: string[] = [];
              for (const { worktree, index } of sections ?? []) {
                const open = (index?.features ?? [])
                  .map((f) => ({ ...f, issues: f.issues.filter((i) => i.status !== "done") }))
                  .filter((f) => f.issues.length > 0);
                if (open.length === 0) continue;
                if (sections.length > 1) lines.push(`-- ${worktree.branch ?? worktree.path}`);
                lines.push(
                  ...open.flatMap((f) =>
                    f.issues.map((i) => `${f.slug}/${i.number}  ${i.status}  ${i.title}`),
                  ),
                );
              }
              return {
                text: lines.length === 0 ? "No open issues." : lines.join("\n"),
                value: { sections },
              };
            });
          },
        }),
        run: cliCommand({
          summary: "Spawn a thread for one ticket or issue",
          description:
            "Ref grammar: <slug>/<NN>, qualified as <slug>/tickets/<NN> or <slug>/issues/<NN> on collision; <slug>/handoff hands a finished map off to to-prd.",
          positionals: [
            { name: "ref", description: "Ticket or issue ref, or <slug>/handoff", required: true },
          ],
          options: { project: projectOption, worktree: worktreeOption, json: jsonOption },
          async run(input, ctx) {
            return runScoped(input.options, ctx, async (projectId, worktrees) => {
              const spawned = await spawnFromInput({
                kind: "ref",
                projectId,
                ref: input.positionals.ref,
                target: explicitTarget(worktrees, input.options.worktree),
              }).catch((cause) => {
                throw new PluginCliError(toError(cause).message, { code: "invalid_value" });
              });
              return { text: `Spawned ${spawned.threadId}: ${spawned.title}`, value: spawned };
            });
          },
        }),
        chart: cliCommand({
          summary: "Chart a new wayfinder map from a loose idea",
          positionals: [{ name: "idea", description: "One or two lines", required: true }],
          options: { project: projectOption, worktree: worktreeOption, json: jsonOption },
          async run(input, ctx) {
            return runScoped(input.options, ctx, async (projectId, worktrees) => {
              const spawned = await spawnFromInput({
                kind: "chart",
                projectId,
                idea: input.positionals.idea,
                target: explicitTarget(worktrees, input.options.worktree),
              });
              return { text: `Spawned ${spawned.threadId}: ${spawned.title}`, value: spawned };
            });
          },
        }),
        orchestrate: cliCommand({
          summary: "Run a batch of open issues in one orchestrator thread",
          description: 'Example: bb workflow orchestrate dark-mode "01 03 04"',
          positionals: [
            { name: "feature", description: "The .scratch/<feature>/ directory", required: true },
            { name: "numbers", description: "Issue numbers, space or comma separated", required: true },
          ],
          options: { project: projectOption, worktree: worktreeOption, json: jsonOption },
          async run(input, ctx) {
            return runScoped(input.options, ctx, async (projectId, worktrees) => {
              const numbers = input.positionals.numbers
                .split(/[\s,]+/)
                .map((n) => n.trim())
                .filter(Boolean);
              const spawned = await spawnFromInput({
                kind: "orchestrate",
                projectId,
                feature: input.positionals.feature,
                numbers,
                target: explicitTarget(worktrees, input.options.worktree),
              }).catch((cause) => {
                throw new PluginCliError(toError(cause).message, { code: "invalid_value" });
              });
              return { text: `Spawned ${spawned.threadId}: ${spawned.title}`, value: spawned };
            });
          },
        }),
      },
    }),
  );
}
