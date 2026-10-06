import { open, readdir, realpath, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { SUBAGENTS_CHANGED, rpcContract, type Subagent, type TranscriptEntry } from "./src/contract";
import { createCollector, type CollectFs, type CollectSdk, type Collector } from "./src/collect";
import { EVENT_TYPES, type EventRow } from "./src/events";
import { clip } from "./src/transcript";

export type { rpcContract } from "./src/contract";

const EVENT_PAGE = 100;
const SHOW_TEXT_LIMIT = 1_500;

export const nodeFs: CollectFs = {
  async stat(path) {
    try {
      const info = await stat(path);
      return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : null;
    } catch {
      return null;
    }
  },
  async read(path, start, end) {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
  readdir: (dir) => readdir(dir),
  realpath: (path) => realpath(path).catch(() => null),
};

export interface PluginOptions {
  fs?: CollectFs;
  tasksRoot?: string;
  sessionsRoot?: string;
  now?: () => number;
}

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function bbSdkAdapter(bb: BbPluginApi): CollectSdk {
  return {
    async listEvents(threadId, afterSeq) {
      const rows: EventRow[] = [];
      let cursor = afterSeq;
      for (;;) {
        const page = await bb.sdk.threads.events.list({
          threadId,
          afterSeq: String(cursor),
          limit: String(EVENT_PAGE),
          order: "asc",
          types: EVENT_TYPES,
        });
        for (const row of page) rows.push({ seq: row.seq, type: row.type, createdAt: row.createdAt, data: row.data });
        if (page.length < EVENT_PAGE) return rows;
        cursor = page[page.length - 1]?.seq ?? cursor;
      }
    },
    async listThreads() {
      const threads = await bb.sdk.threads.list({ archived: false, includeHidden: true, limit: 500 });
      return threads.map((thread) => ({
        id: thread.id,
        providerId: thread.providerId,
        status: thread.status,
        updatedAt: thread.updatedAt,
      }));
    },
  };
}

function statusLine(subagent: Subagent): string {
  const id = subagent.agentId ?? subagent.callId;
  const counts = `${subagent.turns} turns, ${subagent.toolCalls} tools`;
  const mode = subagent.background ? "bg" : "fg";
  return `${id}  ${subagent.status.padEnd(9)} ${subagent.type} (${mode})  ${subagent.description}  [${counts}]`;
}

function entryText(entry: TranscriptEntry): string {
  switch (entry.kind) {
    case "prompt":
      return `> ${clip(entry.text, 300)}`;
    case "text":
      return clip(entry.text, SHOW_TEXT_LIMIT);
    case "tool": {
      const result = entry.result === null ? "  (pending)" : entry.isError ? `  ! ${clip(entry.result.split("\n", 1)[0] ?? "", 200)}` : "";
      return `$ ${entry.summary}${result}`;
    }
  }
}

export function createPlugin(options: PluginOptions = {}) {
  return async function plugin(bb: BbPluginApi) {
    const uid = process.getuid?.() ?? 0;
    const collector: Collector = createCollector({
      sdk: bbSdkAdapter(bb),
      fs: options.fs ?? nodeFs,
      tasksRoot: options.tasksRoot ?? join(tmpdir(), `pi-subagents-${uid}`),
      sessionsRoot: options.sessionsRoot ?? join(homedir(), ".bb", "pi-bridge-sessions"),
      ...(options.now ? { now: options.now } : {}),
      onChange: (threadId) => bb.realtime.publish(SUBAGENTS_CHANGED, { threadId }),
    });

    bb.rpc.register(rpcContract, {
      threadSubagents: async ({ threadId }) => ({ threadId, subagents: await collector.threadSubagents(threadId) }),
      async transcript({ threadId, callId, limit }) {
        const found = await collector.transcript(threadId, callId, limit);
        if (found === null) throw new Error(`No subagent ${callId} in thread ${threadId}`);
        return { entries: found.entries, truncated: found.truncated, children: found.children };
      },
      summaries: async ({ threadIds }) => ({ threads: await collector.summaries(threadIds) }),
    });

    function cliFailure(cause: unknown): never {
      if (cause instanceof PluginCliError) throw cause;
      throw new PluginCliError(errorMessage(cause), { code: "failed" });
    }

    function targetThread(options: { thread?: string; self?: boolean }, ctx: { threadId?: string }): string | null {
      if (options.thread !== undefined) return options.thread;
      if (options.self && ctx.threadId === undefined) {
        throw new PluginCliError("--self needs to run inside a bb thread", { code: "missing_required", hint: "Pass --thread <id>." });
      }
      return ctx.threadId ?? null;
    }

    const reply = (json: boolean | undefined, value: unknown, text: string) => ({
      exitCode: 0,
      stdout: json ? JSON.stringify(value) : text,
    });
    const threadOption = { type: "string" as const, description: "Thread id; defaults to the calling thread" };
    const jsonOption = { type: "boolean" as const, description: "Emit machine-readable JSON" };

    bb.cli.register(
      defineCli({
        name: "subagents",
        summary: "Inspect pi subagents (Agent tool) launched by bb threads",
        commands: {
          list: cliCommand({
            summary: "List a thread's subagents with status and progress; without a thread, recent threads that have subagents",
            options: {
              thread: threadOption,
              self: { type: "boolean", description: "The calling thread (the default inside a bb thread)" },
              json: jsonOption,
            },
            constraints: [{ kind: "at-most-one", options: ["thread", "self"] }],
            async run({ options }, ctx) {
              const threadId = targetThread(options, ctx);
              if (threadId === null) {
                const threads = await collector.summaries().catch(cliFailure);
                const text =
                  threads.length === 0
                    ? "No recent threads with subagents."
                    : threads.map((thread) => `${thread.threadId}  ${thread.running} running / ${thread.total}`).join("\n");
                return reply(options.json, { threads }, text);
              }
              const subagents = await collector.threadSubagents(threadId).catch(cliFailure);
              const text = subagents.length === 0 ? `No subagents in ${threadId}.` : subagents.map(statusLine).join("\n");
              return reply(options.json, { threadId, subagents }, text);
            },
          }),
          show: cliCommand({
            summary: "Show one subagent's status, result and transcript tail",
            positionals: [{ name: "id", description: "Agent id (or a prefix of it) or the Agent tool call id", required: true }],
            options: {
              thread: threadOption,
              tail: { type: "integer", min: 1, max: 200, default: 20, description: "Transcript entries to show (max 200)" },
              json: jsonOption,
            },
            async run({ positionals, options }, ctx) {
              const threadId = targetThread(options, ctx);
              const candidates =
                threadId !== null ? [threadId] : (await collector.recentThreads().catch(cliFailure)).map((thread) => thread.id);
              for (const candidate of candidates) {
                const found = await collector
                  .transcript(candidate, positionals.id, options.tail + 1)
                  .catch((cause: unknown) => (threadId === null ? null : cliFailure(cause)));
                if (found === null) continue;
                const { subagent, entries, truncated, children } = found;
                const lines = [
                  statusLine(subagent),
                  `thread ${candidate}  model ${subagent.model ?? "?"}  started ${subagent.startedAt ?? "?"}  updated ${subagent.updatedAt ?? "?"}`,
                  ...(subagent.outputFile ? [`transcript ${subagent.outputFile}`] : []),
                  ...children.map((child) => `  child ${statusLine(child)}`),
                  "",
                  ...entries.flatMap((entry, index) => (truncated && index === 1 ? ["…", entryText(entry)] : [entryText(entry)])),
                  ...(subagent.result !== null ? ["", `Result: ${clip(subagent.result, SHOW_TEXT_LIMIT * 2)}`] : []),
                ];
                return reply(options.json, { threadId: candidate, subagent, entries, truncated, children }, lines.join("\n"));
              }
              throw new PluginCliError(`No subagent "${positionals.id}"`, {
                code: "invalid_value",
                hint: threadId === null ? "Pass --thread <id>." : `Run: bb subagents list --thread ${threadId}`,
              });
            },
          }),
        },
      }),
    );
  };
}

export default createPlugin();
