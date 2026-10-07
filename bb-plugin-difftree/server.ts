import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { renderTreeText } from "./src/cliText";
import { DIFF_CHANGED, rpcContract, scopeSchema, type DiffChanged, type Scope } from "./src/contract";
import { createDiffService, type DiffSdk, type ScopeStore } from "./src/service";

export type { rpcContract } from "./src/contract";

export const SIGNAL_INTERVAL_MS = 4_000;
const CLI_MAX_LINES = 200;

export function bbDiffSdk(bb: BbPluginApi): DiffSdk {
  const environments = bb.sdk.environments;
  return {
    async environmentIdOf(threadId) {
      const thread = await bb.sdk.threads.get({ threadId });
      return thread.environmentId ?? null;
    },
    status: (environmentId) => environments.status({ environmentId }),
    branches: (environmentId, query) => environments.diffBranches({ environmentId, ...(query ? { query } : {}) }),
    files: (environmentId, target) => environments.diffFiles({ environmentId, ...target }),
    patches: (environmentId, target, paths) =>
      environments.diffPatch({
        environmentId,
        paths,
        target:
          target.target === "uncommitted"
            ? { type: "uncommitted" }
            : { type: target.target, mergeBaseBranch: target.mergeBaseBranch },
      }),
  };
}

export function kvScopeStore(bb: BbPluginApi): ScopeStore {
  const key = (environmentId: string) => `scope:${environmentId}`;
  return {
    async get(environmentId) {
      const parsed = scopeSchema.safeParse(await bb.storage.kv.get(key(environmentId)));
      return parsed.success ? parsed.data : null;
    },
    async set(environmentId, scope) {
      if (scope === null) await bb.storage.kv.delete(key(environmentId));
      else await bb.storage.kv.set(key(environmentId), scope);
    },
  };
}

/** At most one signal per environment per interval; a change inside the window fires once when it closes. */
export function createDiffSignal(publish: (payload: DiffChanged) => void, intervalMs = SIGNAL_INTERVAL_MS) {
  const lastSent = new Map<string, number>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const send = (environmentId: string) => {
    const timer = pending.get(environmentId);
    if (timer !== undefined) clearTimeout(timer);
    pending.delete(environmentId);
    lastSent.set(environmentId, Date.now());
    publish({ environmentId });
  };

  return {
    changed(environmentId: string) {
      if (pending.has(environmentId)) return;
      const wait = (lastSent.get(environmentId) ?? -Infinity) + intervalMs - Date.now();
      if (wait <= 0) send(environmentId);
      else pending.set(environmentId, setTimeout(() => send(environmentId), wait));
    },
    now: send,
    dispose() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}

function cliScope(options: { uncommitted: boolean; base?: string; committed: boolean }): Scope | null {
  if (options.uncommitted) return { kind: "uncommitted" };
  if (options.base === undefined) return null;
  const parsed = scopeSchema.safeParse({ kind: options.committed ? "committed" : "all", base: options.base });
  if (!parsed.success) throw new PluginCliError(`Invalid base branch "${options.base}"`, { code: "invalid_value" });
  return parsed.data;
}

export default async function plugin(bb: BbPluginApi) {
  const service = createDiffService(bbDiffSdk(bb), kvScopeStore(bb));
  const signal = createDiffSignal((payload) => bb.realtime.publish(DIFF_CHANGED, payload));
  bb.onDispose(() => signal.dispose());

  bb.rpc.register(rpcContract, {
    tree: (input) => service.tree(input),
    patch: (input) => service.patch(input),
    branches: (input) => service.branches(input),
    set_scope: (input) => service.setScope(input),
  });

  bb.events.on("experimental_thread.events", ({ thread }) => {
    if (thread.environmentId) signal.changed(thread.environmentId);
  });
  bb.events.on("thread.idle", ({ thread }) => {
    if (thread.environmentId) signal.now(thread.environmentId);
  });

  bb.cli.register(
    defineCli({
      name: "difftree",
      summary:
        "A thread's git changes as a folder tree with +added -removed per folder and file: bb difftree [<thread-id>] [--uncommitted | --base <branch> [--committed]] [--depth <n>] [--json]",
      commands: {},
      root: cliCommand({
        summary: "Print the thread's changes as a folder tree; scope flags apply to this call only",
        positionals: [{ name: "thread", description: "Thread id; defaults to the calling thread" }],
        options: {
          uncommitted: { type: "boolean", description: "Only uncommitted changes (staged, unstaged, untracked)" },
          base: {
            type: "string",
            aliases: ["against", "branch"],
            description: "Compare against the merge-base with this branch (e.g. origin/main); includes uncommitted changes",
          },
          committed: { type: "boolean", description: "With --base: committed changes only, HEAD vs the merge-base" },
          depth: { type: "integer", min: 1, max: 50, description: "Show folders this many levels deep; deeper folders stay collapsed" },
          json: { type: "boolean", description: "Print the TreeResult as JSON (full file list, no line cap)" },
        },
        constraints: [
          { kind: "at-most-one", options: ["uncommitted", "base"] },
          { kind: "requires", option: "committed", needs: ["base"] },
        ],
        async run({ positionals, options }, ctx) {
          const threadId = positionals.thread ?? ctx.threadId;
          if (threadId === undefined) {
            throw new PluginCliError("No thread given", {
              code: "missing_required",
              hint: "Pass a thread id: bb difftree <thread-id>",
            });
          }
          const result = await service.tree({ threadId, scope: cliScope(options) });
          if (options.json) {
            return { exitCode: result.outcome === "unavailable" ? 1 : 0, stdout: `${JSON.stringify(result)}\n` };
          }
          if (result.outcome === "unavailable") throw new PluginCliError(result.message, { code: "unavailable" });
          return { exitCode: 0, stdout: `${renderTreeText(result, { depth: options.depth ?? null, maxLines: CLI_MAX_LINES })}\n` };
        },
      }),
    }),
  );
}
