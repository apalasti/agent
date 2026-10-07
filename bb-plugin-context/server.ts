import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { CONTEXT_CHANGED, rpcContract, type ContextReport, type CourseChange } from "./src/contract";
import { createCollector, type CollectFs, type CollectRoots, type CollectSdk } from "./src/collect";
import type { ContextUsage } from "./src/compose";
import { EVENT_TYPES, type EventRow } from "./src/events";

export type { rpcContract } from "./src/contract";

const EVENT_PAGE = 100;
const DEFAULT_TURNS = 10;
const TOP_ITEMS = 5;

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
      const buffer = Buffer.alloc(Math.max(0, end - start));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
  readdir: (dir) => readdir(dir),
};

export interface PluginOptions {
  fs?: CollectFs;
  roots?: CollectRoots;
  now?: () => number;
}

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const iso = (value: unknown) => (typeof value === "number" ? new Date(value).toISOString() : String(value));

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
        for (const row of page) rows.push({ seq: row.seq, type: row.type, createdAt: iso(row.createdAt), data: row.data });
        if (page.length < EVENT_PAGE) return rows;
        cursor = page[page.length - 1]?.seq ?? cursor;
      }
    },
    async thread(threadId) {
      const result = (await bb.sdk.threads.get({ threadId, include: "environment" })) as Record<string, unknown>;
      const thread = ("thread" in result ? result.thread : result) as { id: string; providerId?: string | null; status: string; sourceThreadId?: string | null };
      const environment = ("environment" in result ? result.environment : null) as { hostId?: string | null } | null;
      return {
        id: thread.id,
        providerId: thread.providerId ?? null,
        status: thread.status,
        sourceThreadId: thread.sourceThreadId ?? null,
        hostId: environment?.hostId ?? null,
      };
    },
    async context(threadId) {
      const result = await bb.sdk.threads.context({ threadId });
      return (result.usage ?? null) as ContextUsage | null;
    },
    async primaryHostId() {
      return (await bb.sdk.system.config()).primaryHostId ?? null;
    },
  };
}

export function formatTokens(value: number | null): string {
  if (value === null) return "?";
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}m`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function percent(value: number, total: number | null): string {
  if (!total) return "";
  const share = (value / total) * 100;
  return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`;
}

function changeLine(change: CourseChange): string {
  switch (change.kind) {
    case "edited":
      return `  -- Edited here${change.discardedTurns !== null ? `: ${change.discardedTurns} turn${change.discardedTurns === 1 ? "" : "s"}${change.tokensBefore !== null ? ` (${formatTokens(change.tokensBefore)})` : ""} discarded` : ""}`;
    case "compacted":
      return `  -- Compacted ${formatTokens(change.tokensBefore)} → ${formatTokens(change.tokensAfter)}`;
    case "compactionSkipped":
      return "  -- Compaction skipped: session too small";
    case "cleared":
      return "  -- Context cleared";
    case "forked":
      return `  -- Forked from ${change.sourceThreadId ?? "another thread"}`;
  }
}

export function showText(report: ContextReport, turnLimit: number): string {
  const { window } = report;
  const lines: string[] = [];
  const approx = window.basis === "estimated" ? "≈" : "";
  const used = window.usedTokens;
  const header = [
    report.threadId,
    report.providerId ?? "unknown provider",
    window.model,
    report.threadStatus,
  ].filter(Boolean);
  lines.push(header.join(" · "));
  if (window.basis === "none" || used === null) {
    lines.push("Context: no measurement yet");
  } else {
    const flags = [window.basis, window.recomputing ? "recomputing" : null, window.autoCompactAt !== null ? `autocompact at ${formatTokens(window.autoCompactAt)}` : null].filter(Boolean);
    lines.push(`Context ${approx}${formatTokens(used)} / ${formatTokens(window.contextWindow)}${window.contextWindow ? ` · ${percent(used, window.contextWindow)}` : ""} (${flags.join(", ")})`);
    lines.push("", "Categories:");
    for (const category of report.categories) {
      if (category.kind === "deferred") continue;
      lines.push(`  ${category.label.padEnd(28)} ${formatTokens(category.tokens).padStart(6)}  ${percent(category.tokens, window.contextWindow ?? used).padStart(5)}`);
    }
  }
  if (report.largest.length > 0) {
    lines.push("", "Largest items:");
    for (const item of report.largest.slice(0, TOP_ITEMS)) {
      const where = item.turnIndex !== null ? `, turn ${item.turnIndex}` : "";
      lines.push(`  ${formatTokens(item.tokens).padStart(6)}  ${item.label}${item.detail ? ` ${item.detail}` : ""} (${item.categoryId}${where})`);
    }
  }
  if (report.turns.length > 0) {
    const shown = report.turns.slice(-turnLimit);
    const first = shown[0]?.index ?? 1;
    lines.push("", `Turns (${shown.length === report.turns.length ? report.turns.length : `last ${shown.length} of ${report.turns.length}`}):`);
    const changes = report.courseChanges.filter((change) => change.beforeTurnIndex >= first);
    for (const turn of shown) {
      for (const change of changes) if (change.beforeTurnIndex === turn.index) lines.push(changeLine(change));
      const added = turn.tokensAfter !== null && turn.tokensBefore !== null ? `+${formatTokens(Math.max(0, turn.tokensAfter - turn.tokensBefore))}` : "";
      const after = turn.tokensAfter !== null ? `→ ${turn.measured ? "" : "≈"}${formatTokens(turn.tokensAfter)}` : "";
      const state = turn.state === "inContext" ? "" : ` [${turn.state}]`;
      lines.push(`  #${turn.index} seq ${turn.requestSeq}  ${added.padStart(7)} ${after.padEnd(9)}${state}  ${turn.preview.slice(0, 80)}`);
    }
    for (const change of changes) if (change.beforeTurnIndex > report.turns.length) lines.push(changeLine(change));
  }
  if (report.notes.length > 0) lines.push("", ...report.notes.map((note) => `Note: ${note}`));
  return lines.join("\n");
}

export function createPlugin(options: PluginOptions = {}) {
  return async function plugin(bb: BbPluginApi) {
    const collector = createCollector({
      sdk: bbSdkAdapter(bb),
      fs: options.fs ?? nodeFs,
      roots: options.roots ?? {
        piSessions: join(homedir(), ".bb", "pi-bridge-sessions"),
        claudeProjects: join(homedir(), ".claude", "projects"),
      },
      memo: {
        get: (key) => bb.storage.kv.get(key),
        set: (key, value) => bb.storage.kv.set(key, value),
      },
      ...(options.now ? { now: options.now } : {}),
    });
    bb.onDispose(() => collector.dispose());

    bb.rpc.register(rpcContract, {
      meter: ({ threadId }) => collector.meter(threadId),
      report: ({ threadId }) => collector.report(threadId),
    });

    bb.events.on("experimental_thread.events", ({ thread, sequence }) => {
      collector.invalidate(thread.id);
      bb.log.debug(`context-changed ${thread.id} seq ${sequence}`);
      bb.realtime.publish(CONTEXT_CHANGED, { threadId: thread.id });
    });

    bb.cli.register(
      defineCli({
        name: "context",
        summary: "Show how full a thread's context window is and what fills it",
        commands: {
          show: cliCommand({
            summary: "Context size, categories, largest items and per-turn growth of a thread",
            options: {
              thread: { type: "string", description: "Thread id; defaults to the calling thread" },
              self: { type: "boolean", description: "The calling thread (the default inside a bb thread)" },
              turns: { type: "integer", min: 1, max: 100, default: DEFAULT_TURNS, description: "Recent turns to list (max 100)" },
              json: { type: "boolean", description: "Emit the full report as JSON" },
            },
            constraints: [{ kind: "at-most-one", options: ["thread", "self"] }],
            async run({ options }, ctx) {
              const threadId = options.thread ?? ctx.threadId;
              if (threadId === undefined) {
                throw new PluginCliError(options.self ? "--self needs to run inside a bb thread" : "No thread given", {
                  code: "missing_required",
                  hint: "Pass --thread <id>.",
                });
              }
              const report = await collector.report(threadId).catch((cause: unknown) => {
                throw new PluginCliError(errorMessage(cause), { code: "failed" });
              });
              return { exitCode: 0, stdout: options.json ? JSON.stringify(report) : showText(report, options.turns) };
            },
          }),
        },
      }),
    );
  };
}

export default createPlugin();
