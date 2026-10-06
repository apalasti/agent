import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { PluginCliError, cliCommand, defineCli, type BbPluginApi, type JsonValue } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  TASK_WORKTREE_PROVIDER_ID,
  WORKTREES_CHANGED,
  rpcContract,
  taskWorktreeInputsSchema,
  type AgentSelection,
  type ProjectConfig,
  type ResolvedConfig,
  type ScratchIndex,
  type Worktree,
  type WorkflowThreadMetadata,
} from "./src/contract";
import { loadConfig, overlayPath, resolveConfig, saveConfig } from "./src/config";
import {
  attachEnvironments,
  checkBranchName,
  createWorktree,
  defaultWorktreePath,
  findWorktreeForBranch,
  listBranches,
  listWorktrees,
  localBranchExists,
  realpathOr,
  removeWorktree,
  runShell,
  spawnRunner,
  worktreeStatus,
  type Runner,
} from "./src/git";
import { applyOverlay } from "./src/overlay";
import {
  chartPrompt,
  findEffort,
  findRunnableTicket,
  handoffPrompt,
  orchestratePrompt,
  scanScratch,
  selectIssues,
  ticketPrompt,
} from "./src/scratch";

export type { rpcContract } from "./src/contract";

const launchRecordSchema = z.object({
  branch: z.string(),
  path: z.string(),
  sourceRoot: z.string(),
  createdByUs: z.boolean(),
  createdBranch: z.boolean(),
});
type LaunchRecord = z.infer<typeof launchRecordSchema>;

const LOG_LIMIT = 64 * 1024;
const launchKey = (pathKey: string) => `launch:${pathKey}`;
const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function boundedLog() {
  const lines: string[] = [];
  return {
    push: (line: string) => lines.push(line),
    text: () => {
      const text = lines.join("\n");
      return text.length > LOG_LIMIT ? `…${text.slice(-LOG_LIMIT)}` : text;
    },
  };
}

export interface PluginOptions {
  runner?: Runner;
}

const AGENT_REQUEST_KEYS = [
  "providerId",
  "model",
  "reasoningLevel",
  "permissionMode",
  "serviceTier",
  "executionInputSources",
] as const;

function agentChoice(request: Record<string, unknown> | undefined): Record<string, unknown> {
  const choice: Record<string, unknown> = {};
  for (const key of AGENT_REQUEST_KEYS) {
    if (request?.[key] !== undefined) choice[key] = request[key];
  }
  return choice;
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const expandHome = (path: string) => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path);

export function createPlugin({ runner = spawnRunner }: PluginOptions = {}) {
  return async function plugin(bb: BbPluginApi) {
    const kv = bb.storage.kv;
    const settings = bb.settings.define({
      templatesDir: {
        type: "string",
        label: "Workflow prompt templates",
        description:
          "Directory holding wayfinder/*.md and issues/orchestrate.md, the templates the pi /wayfinder and /orchestrate commands use. Read on every run.",
        default: join(homedir(), "fun", "agent", "extensions"),
      },
    });
    const templatesDir = async () => expandHome((await settings.get()).templatesDir.trim());
    const publishChanged = (projectId: string) => bb.realtime.publish(WORKTREES_CHANGED, { projectId });

    async function projectSource(projectId: string) {
      const project = await bb.sdk.projects.get({ projectId });
      const source = project.sources.find((candidate) => candidate.isDefault) ?? project.sources[0];
      if (source === undefined) throw new Error(`Project ${project.name} has no checkout`);
      const { primaryHostId } = await bb.sdk.system.config();
      if (primaryHostId !== null && source.hostId !== primaryHostId) {
        throw new Error(`Project ${project.name} lives on another machine; worktrees only supports this machine`);
      }
      return { project, sourceRoot: realpathOr(source.path), hostId: source.hostId };
    }

    async function liveEnvironments(projectId: string) {
      const environments = await bb.sdk.environments.list({ projectId });
      return environments.filter(
        (environment) => environment.status !== "destroyed" && environment.lifecycle.phase !== "destroyed",
      );
    }

    async function projectWorktrees(projectId: string) {
      const { sourceRoot, hostId } = await projectSource(projectId);
      const [worktrees, environments] = await Promise.all([
        listWorktrees(runner, sourceRoot),
        liveEnvironments(projectId),
      ]);
      return { sourceRoot, hostId, worktrees: attachEnvironments(worktrees, environments) };
    }

    async function findProjectWorktree(projectId: string, path: string) {
      const listing = await projectWorktrees(projectId);
      const target = realpathOr(path);
      const worktree = listing.worktrees.find((candidate) => candidate.path === target);
      if (worktree === undefined) throw new Error(`${path} is not a worktree of this project`);
      return { ...listing, worktree };
    }

    async function projectConfig(projectId: string): Promise<ResolvedConfig> {
      const { sourceRoot } = await projectSource(projectId);
      return resolveConfig(await loadConfig(kv, projectId), runner, sourceRoot);
    }

    type SpawnArgs = Parameters<typeof bb.sdk.threads.spawn>[0];

    async function spawnInWorktree(projectId: string, path: string, request: Record<string, unknown>) {
      const { worktree, hostId } = await findProjectWorktree(projectId, path);
      const reusable = (await liveEnvironments(projectId)).find(
        (environment) => environment.status === "ready" && environment.path !== null && realpathOr(environment.path) === worktree.path,
      );
      const environment = reusable
        ? { type: "reuse" as const, environmentId: reusable.id }
        : {
            type: "provider" as const,
            environmentProviderId: "project-checkout",
            inputs: { path: worktree.path },
            machine: { type: "existing" as const, hostId },
          };
      const thread = await bb.sdk.threads.spawn({
        ...(request as unknown as SpawnArgs),
        projectId,
        environment,
      });
      return { threadId: thread.id };
    }

    async function worktreeScratch(projectId: string, path: string): Promise<ScratchIndex> {
      const { worktree } = await findProjectWorktree(projectId, path);
      return scanScratch(worktree.path);
    }

    type WorkflowTarget = { projectId: string; path: string; request?: Record<string, unknown> };

    async function spawnWorkflow(
      target: WorkflowTarget,
      thread: { prompt: string; title: string; metadata: Omit<WorkflowThreadMetadata, "path"> },
      worktreePath: string,
    ) {
      const metadata: WorkflowThreadMetadata = { ...thread.metadata, path: worktreePath };
      return spawnInWorktree(target.projectId, worktreePath, {
        ...agentChoice(target.request),
        prompt: thread.prompt,
        title: thread.title,
        pluginMetadata: metadata,
      });
    }

    async function runTicket(target: WorkflowTarget & { ref: string }) {
      const index = await worktreeScratch(target.projectId, target.path);
      const { effort, ticket } = findRunnableTicket(index, target.ref);
      const prompt = ticketPrompt(await templatesDir(), effort, ticket);
      return spawnWorkflow(
        target,
        {
          prompt,
          title: `${ticket.ref}: ${ticket.title}`,
          metadata: { kind: "ticket", effort: effort.slug, ref: ticket.ref },
        },
        index.root,
      );
    }

    async function orchestrate(target: WorkflowTarget & { effort: string; issues: readonly string[] }) {
      const index = await worktreeScratch(target.projectId, target.path);
      const effort = findEffort(index, target.effort);
      const batch = selectIssues(effort, target.issues);
      const prompt = orchestratePrompt(await templatesDir(), batch);
      const numbers = batch.map((issue) => issue.number);
      const title =
        batch.length === 1 && batch[0]
          ? `${batch[0].ref}: ${batch[0].title}`
          : `${effort.slug}/${numbers.join(", ")}: orchestrate`;
      return spawnWorkflow(
        target,
        { prompt, title, metadata: { kind: "orchestrate", effort: effort.slug, ref: `${effort.slug}/${numbers.join(",")}` } },
        index.root,
      );
    }

    async function chart(target: WorkflowTarget & { idea: string }) {
      const { worktree } = await findProjectWorktree(target.projectId, target.path);
      const idea = target.idea.trim();
      const prompt = chartPrompt(await templatesDir(), worktree.path, idea);
      return spawnWorkflow(
        target,
        { prompt, title: `Chart: ${truncate(idea, 60)}`, metadata: { kind: "chart", effort: null, ref: null } },
        worktree.path,
      );
    }

    async function handoff(target: WorkflowTarget & { effort: string }) {
      const index = await worktreeScratch(target.projectId, target.path);
      const effort = findEffort(index, target.effort);
      if (effort.mapPath === null) throw new Error(`Effort ${effort.slug} has no MAP.md`);
      if (!effort.handoffReady) {
        const open = effort.tickets.filter((ticket) => ticket.state !== "done").map((ticket) => ticket.number);
        throw new Error(`${effort.slug} still has open tickets: ${open.join(", ")}`);
      }
      const prompt = handoffPrompt(await templatesDir(), effort);
      return spawnWorkflow(
        target,
        { prompt, title: `${effort.slug}: hand off to PRD`, metadata: { kind: "handoff", effort: effort.slug, ref: null } },
        index.root,
      );
    }

    async function agentDefaults(projectId: string): Promise<AgentSelection | null> {
      try {
        const { hostId } = await projectSource(projectId);
        const { generalSettings } = await bb.sdk.system.config();
        const preference = [generalSettings.defaultProviderId, ...generalSettings.providerOrder];
        const rank = (id: string) => {
          const index = preference.indexOf(id);
          return index === -1 ? preference.length : index;
        };
        const providers = (await bb.sdk.providers.list({ hostId }))
          .filter((provider) => provider.available)
          .sort((a, b) => rank(a.id) - rank(b.id));
        for (const provider of providers) {
          const { models } = await bb.sdk.providers.models({ hostId, providerId: provider.id });
          const model = models.find((candidate) => candidate.isDefault) ?? models[0];
          if (model !== undefined) {
            return { providerId: provider.id, model: model.model, reasoningLevel: model.defaultReasoningEffort };
          }
        }
        return null;
      } catch (cause) {
        bb.log.warn(`agentDefaults failed: ${errorMessage(cause)}`);
        return null;
      }
    }

    async function removeProjectWorktree(args: {
      projectId: string;
      path: string;
      deleteBranch: boolean;
      force: boolean;
    }) {
      const { sourceRoot, worktree } = await findProjectWorktree(args.projectId, args.path);
      if (worktree.isMain) throw new Error("The main checkout cannot be removed");
      if (!args.force && !worktree.isPrunable) {
        const status = await worktreeStatus(runner, worktree.path);
        if (status.dirtyFiles > 0) {
          throw new Error(`${worktree.path} has ${status.dirtyFiles} uncommitted change(s); pass force to remove anyway`);
        }
      }
      const config = await projectConfig(args.projectId);
      const log = boundedLog();

      const archivedThreadIds: string[] = [];
      for (const environmentId of worktree.environmentIds) {
        const threads = await bb.sdk.threads.list({ environmentId, archived: false, includeHidden: true, limit: 500 });
        for (const thread of threads) {
          await bb.sdk.threads.archive({ threadId: thread.id });
          archivedThreadIds.push(thread.id);
        }
      }
      if (archivedThreadIds.length > 0) log.push(`Archived ${archivedThreadIds.length} thread(s)`);

      if (config.teardownCommand !== null) {
        log.push(`$ ${config.teardownCommand}`);
        await runShell(runner, config.teardownCommand, {
          cwd: sourceRoot,
          env: { SOURCE_ROOT: sourceRoot, WORKTREE_PATH: worktree.path, BRANCH: worktree.branch ?? "" },
          onLine: log.push,
        });
      }

      const { deletedBranch } = await removeWorktree({
        runner,
        sourceRoot,
        path: worktree.path,
        branch: worktree.branch,
        tool: config.effectiveTool,
        force: args.force,
        deleteBranch: args.deleteBranch,
        log: log.push,
      });
      log.push(`Removed ${worktree.path}${deletedBranch ? ` and branch ${deletedBranch}` : ""}`);
      publishChanged(args.projectId);
      return { archivedThreadIds, deletedBranch, log: log.text() };
    }

    bb.experimental_environments.register({
      id: TASK_WORKTREE_PROVIDER_ID,
      displayName: "Task worktree",
      description: "Create a git worktree for a new branch, with the project's agent overlay applied.",
      icon: "GitBranch",
      requires: { gitCheckout: true },
      inputs: taskWorktreeInputsSchema,
      async availability({ host }) {
        const { primaryHostId } = await bb.sdk.system.config();
        return primaryHostId === null || host.id === primaryHostId
          ? { status: "available" }
          : { status: "unavailable", message: "Task worktrees run on this machine only" };
      },
      async validate({ projectCheckout, inputs }) {
        if (inputs.branch === undefined) return { action: "accept" };
        const problem = await checkBranchName(runner, projectCheckout.path, inputs.branch);
        return problem === null ? { action: "accept" } : { action: "refuse", message: problem };
      },
      async create(context) {
        const { project, projectCheckout, inputs, pathKey, report, signal } = context;
        const sourceRoot = realpathOr(projectCheckout.path);
        try {
          const config = await resolveConfig(await loadConfig(kv, project.id), runner, sourceRoot);
          const branch = inputs.branch ?? context.suggestedBranchName;
          const base = inputs.from ?? config.effectiveBaseRef;
          const problem = await checkBranchName(runner, sourceRoot, branch);
          if (problem !== null) return { status: "failed", message: problem };

          const prior = launchRecordSchema.safeParse(await kv.get(launchKey(pathKey)));
          const existing = await findWorktreeForBranch(runner, sourceRoot, branch);
          const targetPath = existing?.path ?? (prior.success ? prior.data.path : defaultWorktreePath(sourceRoot, branch));
          if (!(await context.experimental_claimPath(targetPath))) {
            return { status: "failed", message: `Another launch is already preparing ${targetPath}` };
          }

          report.step(existing ? `Reusing worktree for ${branch}` : `Creating worktree ${branch} from ${base}`);
          const created = await createWorktree({
            runner,
            sourceRoot,
            branch,
            base,
            tool: config.effectiveTool,
            log: report.log,
            signal,
          });
          const record: LaunchRecord = {
            branch,
            path: created.path,
            sourceRoot,
            createdByUs: (prior.success && prior.data.createdByUs) || created.createdByUs,
            createdBranch: (prior.success && prior.data.createdBranch) || created.createdBranch,
          };
          await kv.set(launchKey(pathKey), record);
          publishChanged(project.id);

          if (config.effectiveOverlayDir !== null) {
            report.step("Applying overlay");
            await applyOverlay({
              runner,
              sourceRoot,
              worktreePath: created.path,
              overlayDir: overlayPath(sourceRoot, config.effectiveOverlayDir),
              log: report.log,
            });
          }
          if (config.setupCommand !== null) {
            report.step("Running setup command");
            await runShell(runner, config.setupCommand, {
              cwd: created.path,
              env: { SOURCE_ROOT: sourceRoot, WORKTREE_PATH: created.path, BRANCH: branch },
              onLine: report.log,
              signal,
            });
          }
          return {
            status: "created",
            path: created.path,
            ownsPath: false,
            mergeBaseBranch: base,
            resource: record as unknown as JsonValue,
          };
        } catch (cause) {
          bb.log.warn(`task-worktree create failed: ${errorMessage(cause)}`);
          return { status: "failed", message: errorMessage(cause) };
        }
      },
      async remove({ environment, pathKey, resource, report }) {
        const parsed = launchRecordSchema.safeParse(resource ?? (await kv.get(launchKey(pathKey))));
        if (environment === null && parsed.success && parsed.data.createdByUs) {
          const record = parsed.data;
          report.step(`Removing worktree of cancelled launch ${record.path}`);
          try {
            if ((await listWorktrees(runner, record.sourceRoot)).some((worktree) => worktree.path === record.path)) {
              await removeWorktree({
                runner,
                sourceRoot: record.sourceRoot,
                path: record.path,
                branch: record.branch,
                tool: "git",
                force: true,
                deleteBranch: record.createdBranch,
                log: report.log,
              });
            }
          } catch (cause) {
            return { status: "failed", message: errorMessage(cause) };
          }
        }
        await kv.delete(launchKey(pathKey));
        return { status: "removed" };
      },
    });

    bb.rpc.register(rpcContract, {
      async listWorktrees({ projectId }) {
        const { sourceRoot, worktrees } = await projectWorktrees(projectId);
        return { projectId, sourcePath: sourceRoot, worktrees };
      },
      async worktreeStatus({ projectId, path }) {
        const { worktree } = await findProjectWorktree(projectId, path);
        return worktreeStatus(runner, worktree.path);
      },
      async branches({ projectId, query, limit }) {
        const { sourceRoot } = await projectSource(projectId);
        return { branches: await listBranches(runner, sourceRoot, query, limit) };
      },
      async validateBranch({ projectId, branch }) {
        const { sourceRoot } = await projectSource(projectId);
        const problem = await checkBranchName(runner, sourceRoot, branch);
        if (problem !== null) return { ok: false, message: problem, existingWorktreePath: null };
        const existing = await findWorktreeForBranch(runner, sourceRoot, branch);
        if (existing !== null) {
          return { ok: true, message: "Branch already has a worktree; it will be reused", existingWorktreePath: existing.path };
        }
        const message = (await localBranchExists(runner, sourceRoot, branch))
          ? "Existing branch will be checked out"
          : null;
        return { ok: true, message, existingWorktreePath: null };
      },
      spawnInWorktree: ({ projectId, path, request }) => spawnInWorktree(projectId, path, request),
      removeWorktree: (input) => removeProjectWorktree(input),
      getConfig: ({ projectId }) => projectConfig(projectId),
      async setConfig({ projectId, config }) {
        await saveConfig(kv, projectId, config);
        return projectConfig(projectId);
      },
      scratch: ({ projectId, path }) => worktreeScratch(projectId, path),
      runTicket: (input) => runTicket(input),
      orchestrate: (input) => orchestrate(input),
      chart: (input) => chart(input),
      handoff: (input) => handoff(input),
      agentDefaults: ({ projectId }) => agentDefaults(projectId),
    });

    async function resolveProjectId(requested: string | undefined, contextProjectId: string | undefined) {
      const projects = await bb.sdk.projects.list();
      const names = projects.map((project) => project.name).join(", ") || "none";
      if (requested !== undefined) {
        const match = projects.find((project) => project.id === requested || project.name === requested);
        if (match) return match.id;
        throw new PluginCliError(`No project "${requested}"`, { code: "invalid_value", hint: `Projects: ${names}` });
      }
      if (contextProjectId !== undefined && projects.some((project) => project.id === contextProjectId)) {
        return contextProjectId;
      }
      if (projects.length === 1 && projects[0]) return projects[0].id;
      throw new PluginCliError("Which project?", { code: "missing_required", hint: `Pass --project. Projects: ${names}` });
    }

    function matchWorktree(worktrees: Worktree[], query: string, cwd: string | undefined): Worktree {
      const asPath = isAbsolute(query) ? query : cwd !== undefined ? join(cwd, query) : null;
      const match =
        worktrees.find((worktree) => worktree.branch === query) ??
        worktrees.find((worktree) => asPath !== null && worktree.path === realpathOr(asPath)) ??
        worktrees.find((worktree) => basename(worktree.path) === query);
      if (match) return match;
      throw new PluginCliError(`No worktree matches "${query}"`, {
        code: "invalid_value",
        hint: `Worktrees: ${worktrees.map((worktree) => worktree.branch ?? worktree.path).join(", ")}`,
      });
    }

    function cliFailure(cause: unknown): never {
      if (cause instanceof PluginCliError) throw cause;
      throw new PluginCliError(errorMessage(cause), { code: "failed" });
    }

    const reply = (json: boolean | undefined, value: unknown, text: string) => ({
      exitCode: 0,
      stdout: json ? JSON.stringify(value) : text,
    });

    const projectOption = {
      type: "string" as const,
      description: "Project id or name; defaults to the current thread's project",
    };
    const jsonOption = { type: "boolean" as const, description: "Emit machine-readable JSON" };

    async function readPrompt(
      options: { prompt?: string; "prompt-file"?: string },
      positional: string[],
      cwd: string | undefined,
    ): Promise<string> {
      if (options["prompt-file"] !== undefined) {
        const file = options["prompt-file"];
        if (file === "-") {
          throw new PluginCliError("--prompt-file - is not supported", {
            code: "invalid_value",
            hint: "Pipe the prompt with --prompt-stdin instead.",
          });
        }
        const path = isAbsolute(file) ? file : cwd !== undefined ? join(cwd, file) : null;
        if (path === null) {
          throw new PluginCliError("--prompt-file needs an absolute path here", { code: "invalid_value" });
        }
        return (await bb.sdk.files.read({ path })).content;
      }
      return options.prompt ?? positional.join(" ");
    }

    const THREADS_PER_WORKTREE = 10;

    const pathOption = {
      type: "string" as const,
      description:
        "Worktree path, branch, or directory name; defaults to the calling thread's worktree, else the main checkout",
    };

    async function cliWorktreePath(
      projectId: string,
      requested: string | undefined,
      ctx: { cwd?: string; threadId?: string },
    ): Promise<string> {
      const { worktrees } = await projectWorktrees(projectId).catch(cliFailure);
      if (requested !== undefined) return matchWorktree(worktrees, requested, ctx.cwd).path;
      if (ctx.threadId !== undefined) {
        const thread = await bb.sdk.threads.get({ threadId: ctx.threadId }).catch(() => null);
        const caller = worktrees.find(
          (worktree) => thread?.environmentId != null && worktree.environmentIds.includes(thread.environmentId),
        );
        if (caller) return caller.path;
      }
      const main = worktrees.find((worktree) => worktree.isMain) ?? worktrees[0];
      if (main === undefined) throw new PluginCliError("The project has no git worktrees", { code: "failed" });
      return main.path;
    }

    const spawned = (json: boolean | undefined, threadId: string, what: string) =>
      reply(json, { threadId }, `${threadId}\n${what}. Follow it with: bb thread show ${threadId}`);

    function scratchText(index: ScratchIndex): string {
      if (index.efforts.length === 0) return `No efforts in ${index.scratchDir}`;
      const lines = [index.scratchDir];
      for (const effort of index.efforts) {
        const done = effort.tickets.filter((ticket) => ticket.state === "done").length;
        const map = effort.mapPath === null ? "" : `  map ${done}/${effort.tickets.length} closed`;
        lines.push(`${effort.slug}${map}${effort.handoffReady ? "  ready to hand off" : ""}`);
        for (const ticket of effort.tickets.filter((candidate) => candidate.state !== "done")) {
          const mark = ticket.state === "frontier" ? "▸" : "·";
          const note =
            ticket.state === "blocked"
              ? `  blocked by ${ticket.blockers.join(", ")}`
              : ticket.claimed !== null
                ? `  claimed ${ticket.claimed}`
                : "";
          lines.push(`  ${mark} ${ticket.ref}  [${ticket.type}] ${ticket.title}${note}`);
        }
        const issues = effort.issues.filter((issue) => issue.status !== "done");
        for (const issue of issues) lines.push(`  issue ${issue.ref}  ${issue.status}  ${issue.title}`);
        const doneIssues = effort.issues.length - issues.length;
        if (doneIssues > 0) lines.push(`  ${doneIssues} issue(s) done`);
      }
      return lines.join("\n");
    }

    bb.cli.register(
      defineCli({
        name: "task",
        summary: "Start agent threads in fresh git worktrees and manage those worktrees",
        commands: {
          new: cliCommand({
            summary: "Create a worktree for <branch> and start a thread in it with the prompt",
            description:
              "The worktree is created asynchronously by the task-worktree environment provider; the thread id is printed immediately. Watch progress with `bb thread show <id>`.",
            positionals: [
              { name: "branch", description: "New (or existing) branch name", required: true },
              { name: "prompt", description: "Prompt text; quote it or pass several words", variadic: true },
            ],
            options: {
              from: { type: "string", description: "Base ref for a new branch; defaults to the project's configured base" },
              prompt: {
                type: "string",
                stdin: true,
                description: "Prompt text; --prompt-stdin reads it from stdin",
              },
              "prompt-file": { type: "string", description: "Read the prompt from this file on the bb server's machine" },
              title: { type: "string", description: "Thread title; defaults to bb's generated title" },
              project: projectOption,
              json: jsonOption,
            },
            constraints: [{ kind: "at-most-one", options: ["prompt", "prompt-file"] }],
            async run({ positionals, options }, ctx) {
              const projectId = await resolveProjectId(options.project, ctx.projectId);
              const prompt = (await readPrompt(options, positionals.prompt, ctx.cwd)).trim();
              if (prompt === "") {
                throw new PluginCliError("Empty prompt", {
                  code: "missing_required",
                  hint: 'Pass the prompt as an argument, --prompt-stdin, or --prompt-file <path>.',
                });
              }
              const { sourceRoot, hostId } = await projectSource(projectId).catch(cliFailure);
              const problem = await checkBranchName(runner, sourceRoot, positionals.branch);
              if (problem !== null) throw new PluginCliError(problem, { code: "invalid_value" });
              const inputs = { branch: positionals.branch, ...(options.from ? { from: options.from } : {}) };
              const thread = await bb.sdk.threads
                .spawn({
                  projectId,
                  prompt,
                  ...(options.title ? { title: options.title } : {}),
                  environment: {
                    type: "provider",
                    environmentProviderId: TASK_WORKTREE_PROVIDER_ID,
                    inputs,
                    machine: { type: "existing", hostId },
                  },
                })
                .catch(cliFailure);
              return reply(
                options.json,
                { threadId: thread.id, projectId, branch: positionals.branch, from: options.from ?? null },
                `${thread.id}\nStarting thread in a new worktree for ${positionals.branch}. Follow it with: bb thread show ${thread.id}`,
              );
            },
          }),
          list: cliCommand({
            summary: "List the project's git worktrees and the threads running in each",
            options: { project: projectOption, json: jsonOption },
            async run({ options }, ctx) {
              const projectId = await resolveProjectId(options.project, ctx.projectId);
              const { worktrees } = await projectWorktrees(projectId).catch(cliFailure);
              const threads = await bb.sdk.threads.list({ projectId, archived: false, limit: 500 });
              const entries = worktrees.map((worktree) => ({
                ...worktree,
                threads: threads
                  .filter((thread) => thread.environmentPath !== null && realpathOr(thread.environmentPath) === worktree.path)
                  .map((thread) => ({ id: thread.id, title: thread.title ?? thread.titleFallback, status: thread.status })),
              }));
              const lines: string[] = [];
              for (const entry of entries) {
                const name = entry.branch ?? `(detached ${entry.head?.slice(0, 8) ?? ""})`;
                lines.push(`${entry.isMain ? "* " : "  "}${name}  ${entry.path}${entry.isPrunable ? "  [prunable]" : ""}`);
                for (const thread of entry.threads.slice(0, THREADS_PER_WORKTREE)) {
                  lines.push(`      ${thread.id}  ${thread.status}  ${thread.title ?? ""}`);
                }
                if (entry.threads.length > THREADS_PER_WORKTREE) {
                  lines.push(`      … ${entry.threads.length - THREADS_PER_WORKTREE} more`);
                }
              }
              return reply(options.json, { projectId, worktrees: entries }, lines.join("\n"));
            },
          }),
          rm: cliCommand({
            summary: "Archive a worktree's threads, run the teardown command, and remove the worktree",
            positionals: [{ name: "worktree", description: "Branch name, directory name, or path", required: true }],
            options: {
              "delete-branch": { type: "boolean", description: "Also delete the local branch (git branch -D)" },
              force: { type: "boolean", description: "Remove even with uncommitted changes" },
              project: projectOption,
              json: jsonOption,
            },
            async run({ positionals, options }, ctx) {
              const projectId = await resolveProjectId(options.project, ctx.projectId);
              const { worktrees } = await projectWorktrees(projectId).catch(cliFailure);
              const worktree = matchWorktree(worktrees, positionals.worktree, ctx.cwd);
              const result = await removeProjectWorktree({
                projectId,
                path: worktree.path,
                deleteBranch: options["delete-branch"],
                force: options.force,
              }).catch(cliFailure);
              return reply(options.json, { path: worktree.path, ...result }, result.log);
            },
          }),
          scratch: cliCommand({
            summary: "List a worktree's .scratch efforts: map tickets (frontier/blocked/closed) and issues",
            options: { path: pathOption, project: projectOption, json: jsonOption },
            async run({ options }, ctx) {
              const projectId = await resolveProjectId(options.project, ctx.projectId);
              const path = await cliWorktreePath(projectId, options.path, ctx);
              const index = await worktreeScratch(projectId, path).catch(cliFailure);
              return reply(options.json, index, scratchText(index));
            },
          }),
          run: cliCommand({
            summary: "Start a thread on a frontier map ticket with its wayfinder prompt",
            positionals: [{ name: "ref", description: "<effort>/<NN>, e.g. plugin-demo/03", required: true }],
            options: { path: pathOption, project: projectOption, json: jsonOption },
            async run({ positionals, options }, ctx) {
              const projectId = await resolveProjectId(options.project, ctx.projectId);
              const path = await cliWorktreePath(projectId, options.path, ctx);
              const { threadId } = await runTicket({ projectId, path, ref: positionals.ref }).catch(cliFailure);
              return spawned(options.json, threadId, `Started ${positionals.ref}`);
            },
          }),
          orchestrate: cliCommand({
            summary: "Start an orchestrator thread over an effort's issues (all open ones when none are named)",
            positionals: [
              { name: "effort", description: "Effort slug under .scratch/", required: true },
              { name: "issues", description: "Issue numbers, e.g. 01 03", variadic: true },
            ],
            options: { path: pathOption, project: projectOption, json: jsonOption },
            async run({ positionals, options }, ctx) {
              const projectId = await resolveProjectId(options.project, ctx.projectId);
              const path = await cliWorktreePath(projectId, options.path, ctx);
              const issues = positionals.issues.flatMap((value) => value.split(",")).filter((value) => value.trim() !== "");
              const { threadId } = await orchestrate({ projectId, path, effort: positionals.effort, issues }).catch(cliFailure);
              return spawned(options.json, threadId, `Orchestrating ${positionals.effort}`);
            },
          }),
          chart: cliCommand({
            summary: "Start a thread that charts a new wayfinder map from an idea",
            positionals: [{ name: "idea", description: "One or two lines; quote it or pass several words", required: true, variadic: true }],
            options: { path: pathOption, project: projectOption, json: jsonOption },
            async run({ positionals, options }, ctx) {
              const projectId = await resolveProjectId(options.project, ctx.projectId);
              const path = await cliWorktreePath(projectId, options.path, ctx);
              const idea = positionals.idea.join(" ").trim();
              if (idea === "") throw new PluginCliError("Empty idea", { code: "missing_required" });
              const { threadId } = await chart({ projectId, path, idea }).catch(cliFailure);
              return spawned(options.json, threadId, "Charting");
            },
          }),
          handoff: cliCommand({
            summary: "Start a thread that hands a finished map off to to-prd and to-issues",
            positionals: [{ name: "effort", description: "Effort slug whose map tickets are all closed", required: true }],
            options: { path: pathOption, project: projectOption, json: jsonOption },
            async run({ positionals, options }, ctx) {
              const projectId = await resolveProjectId(options.project, ctx.projectId);
              const path = await cliWorktreePath(projectId, options.path, ctx);
              const { threadId } = await handoff({ projectId, path, effort: positionals.effort }).catch(cliFailure);
              return spawned(options.json, threadId, `Handing off ${positionals.effort}`);
            },
          }),
          config: cliCommand({
            summary: "Show or change the project's worktree settings",
            description: 'Pass an empty string (--base "") to reset a value to its default.',
            options: {
              base: { type: "string", description: "Default base ref for new branches, e.g. origin/main" },
              overlay: { type: "string", description: "Overlay directory, relative to the checkout (default .myscripts/agents)" },
              setup: { type: "string", description: "Shell command run in a new worktree after the overlay" },
              teardown: { type: "string", description: "Shell command run in the main checkout before a worktree is removed" },
              tool: { type: "enum", values: ["auto", "gtr", "git"], description: "Worktree tool; auto uses git gtr when installed" },
              project: projectOption,
              json: jsonOption,
            },
            async run({ options }, ctx) {
              const projectId = await resolveProjectId(options.project, ctx.projectId);
              const orNull = (value: string | undefined) =>
                value === undefined ? undefined : value.trim() === "" ? null : value.trim();
              const patch: Partial<ProjectConfig> = {};
              const base = orNull(options.base);
              const overlay = orNull(options.overlay);
              const setup = orNull(options.setup);
              const teardown = orNull(options.teardown);
              if (base !== undefined) patch.baseRef = base;
              if (overlay !== undefined) patch.overlayDir = overlay;
              if (setup !== undefined) patch.setupCommand = setup;
              if (teardown !== undefined) patch.teardownCommand = teardown;
              if (options.tool !== undefined) patch.tool = options.tool as ProjectConfig["tool"];
              if (Object.keys(patch).length > 0) await saveConfig(kv, projectId, patch);
              const config = await projectConfig(projectId).catch(cliFailure);
              const show = (value: string | null, effective?: string | null) =>
                value ?? (effective != null ? `(default: ${effective})` : "(none)");
              return reply(
                options.json,
                config,
                [
                  `base      ${show(config.baseRef, config.effectiveBaseRef)}`,
                  `overlay   ${show(config.overlayDir, config.effectiveOverlayDir)}`,
                  `setup     ${show(config.setupCommand)}`,
                  `teardown  ${show(config.teardownCommand)}`,
                  `tool      ${config.tool} (${config.effectiveTool})`,
                ].join("\n"),
              );
            },
          }),
        },
      }),
    );
  };
}

export default createPlugin();
