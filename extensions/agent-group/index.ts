/**
 * Agent Group — run several pi agents on the same problem, grouped in one tmux window.
 *
 * Model: one problem = one worktree = one tmux window. Each agent is a real `pi`
 * process in its own pane of that window, so every agent keeps working whether or
 * not you're looking at it. Exactly one pane is zoomed at a time, so it always
 * feels like a single full-screen pi TUI.
 *
 *   /spawn              → open a new blank agent (jumps to it, zoomed)
 *   /spawn <task>       → spawn a background agent seeded with <task> (stays put)
 *   /switch  or  ←      → pick another agent in this group and zoom into it
 *                         (← only fires when the input box is empty)
 *
 * Panes are tagged with the tmux per-pane option `@pi_agent` (the agent's label),
 * which doubles as the group registry — no state file. `TMUX_PANE` identifies our
 * own pane reliably even when we're an unattended background pane.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ─── constants ──────────────────────────────────────────────────────────────

const AGENT_OPT = "@pi_agent"; // per-pane tmux option holding the agent's label
const SEED_ENV = "PI_SPAWN_TASK"; // env passed to a freshly spawned, seeded agent
const LEFT_ARROW = ["\x1b[D", "\x1bOD"]; // CSI and application-cursor-mode left

// Per-pane activity, published by each agent and read by the switcher.
const STATE_OPT = "@pi_state"; // "working" | "idle"
const TOOL_OPT = "@pi_tool"; // current tool + hint, e.g. "bash: npm test"
const TOKENS_OPT = "@pi_tokens"; // tokens used (absolute), e.g. "12340"
const TURNS_OPT = "@pi_turns"; // LLM turns in the current run
const TOOLS_OPT = "@pi_tools"; // tool calls in the current run
const START_OPT = "@pi_start"; // run start time (ms epoch)
const END_OPT = "@pi_end"; // run end time (ms epoch), "" while working
const FINISHED_OPT = "@pi_finished"; // "1" when finished and you haven't looked yet

// Per-run counters (this process).
let runTurns = 0;
let runTools = 0;

// The ← input tap must be torn down before re-binding, otherwise stale taps pile
// up. session_start fires on reload/fork, but on *reload* the module re-evaluates
// with fresh module scope while the previous module's tap stays registered in the
// TUI — bound to a dead ctx whose getEditorText() returns "" forever, so its
// empty-editor guard always passes and it opens the switcher no matter what you've
// typed. We stash the unsubscribe on globalThis (survives reload) so every new tap
// can drop the previous one for good.
const TAP_KEY = "__piAgentGroupUnsubInput";
function priorInputTap(): (() => void) | undefined {
  return (globalThis as any)[TAP_KEY];
}
function setInputTap(unsub: (() => void) | undefined) {
  (globalThis as any)[TAP_KEY] = unsub;
}

// Latest session ctx and the focus-polling timer. Per-process.
let currentCtx: any;
let statusTimer: ReturnType<typeof setInterval> | undefined;
// Pane ids we've already toasted, so each finish notifies exactly once.
const notified = new Set<string>();

// ─── tmux helpers ─────────────────────────────────────────────────────────────

function myPane(): string | undefined {
  // tmux exports the current pane's id into each pane's environment.
  return process.env.TMUX && process.env.TMUX_PANE ? process.env.TMUX_PANE : undefined;
}

async function tmux(pi: ExtensionAPI, args: string[]) {
  return pi.exec("tmux", args, { timeout: 5_000 });
}

async function paneLabel(pi: ExtensionAPI, pane: string): Promise<string> {
  const r = await tmux(pi, ["display-message", "-p", "-t", pane, `#{${AGENT_OPT}}`]);
  return r.code === 0 ? r.stdout.trim() : "";
}

async function tagPane(pi: ExtensionAPI, pane: string, label: string) {
  await tmux(pi, ["set-option", "-p", "-t", pane, AGENT_OPT, label]);
}

interface Agent {
  id: string;
  label: string;
  active: boolean;
  state: string; // "working" | "idle" | ""
  tool: string; // current tool + hint, or ""
  tokens: string; // tokens used (absolute), or ""
  turns: string; // LLM turns in the current run, or ""
  tools: string; // tool calls in the current run, or ""
  start: string; // run start (ms epoch), or ""
  end: string; // run end (ms epoch), or "" while working
  finished: boolean; // finished and not yet looked at
}

async function listAgents(pi: ExtensionAPI, pane: string): Promise<Agent[]> {
  // -t <pane> scopes list-panes to that pane's window (our group).
  const fmt = [
    "#{pane_id}",
    `#{${AGENT_OPT}}`,
    "#{pane_active}",
    `#{${STATE_OPT}}`,
    `#{${TOOL_OPT}}`,
    `#{${TOKENS_OPT}}`,
    `#{${TURNS_OPT}}`,
    `#{${TOOLS_OPT}}`,
    `#{${START_OPT}}`,
    `#{${END_OPT}}`,
    `#{${FINISHED_OPT}}`,
  ].join("\t");
  const r = await tmux(pi, ["list-panes", "-t", pane, "-F", fmt]);
  if (r.code !== 0) return [];

  const agents: Agent[] = [];
  for (const line of r.stdout.trim().split("\n")) {
    if (!line) continue;
    const [id, label, active, state, tool, tokens, turns, tools, start, end, finished] =
      line.split("\t");
    if (!label) continue; // untagged panes aren't part of the group
    agents.push({
      id,
      label,
      active: active === "1",
      state: state ?? "",
      tool: tool ?? "",
      tokens: tokens ?? "",
      turns: turns ?? "",
      tools: tools ?? "",
      start: start ?? "",
      end: end ?? "",
      finished: finished === "1",
    });
  }
  return agents;
}

// ─── repo root (group is keyed to the worktree) ────────────────────────────────

async function repoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
  const r = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5_000 });
  return r.code === 0 ? r.stdout.trim() : cwd;
}

// ─── spawn ──────────────────────────────────────────────────────────────────

async function spawnAgent(pi: ExtensionAPI, ctx: any, task: string) {
  const pane = myPane();
  if (!pane) {
    ctx.ui.notify("Agent groups need a tmux session — start pi inside tmux.", "error");
    return;
  }

  const label = task.trim();
  const seeded = label.length > 0;
  const root = await repoRoot(pi, ctx.cwd);

  // -d keeps focus here (background grind) for seeded agents; blank agents take
  // focus so you can type the task. -P -F prints the new pane id.
  const args = ["split-window", "-t", pane, "-c", root, "-P", "-F", "#{pane_id}"];
  if (seeded) args.push("-d", "-e", `${SEED_ENV}=${label}`);
  args.push("pi");

  const r = await tmux(pi, args);
  if (r.code !== 0) {
    ctx.ui.notify(`Could not spawn agent: ${r.stderr.trim() || "tmux split-window failed"}`, "error");
    return;
  }
  const newPane = r.stdout.trim();

  if (seeded) {
    // The new agent tags its own pane from SEED_ENV on session_start; we keep the
    // current agent zoomed so spawning feels like fire-and-forget.
    await tmux(pi, ["resize-pane", "-Z", "-t", pane]);
    ctx.ui.notify(`Spawned background agent: ${label}`, "info");
  } else {
    await tagPane(pi, newPane, "agent");
    await tmux(pi, ["resize-pane", "-Z", "-t", newPane]);
  }
}

// ─── switcher (/switch or ← on an empty editor) ─────────────────────────────────

async function openSwitcher(pi: ExtensionAPI, ctx: any) {
  const pane = myPane();
  if (!pane) return;

  const agents = await listAgents(pi, pane);
  if (agents.length <= 1) {
    ctx.ui.notify(
      agents.length === 0 ? "No agents in this group yet." : "This is the only agent in the group.",
      "info",
    );
    return;
  }

  const labels = agents.map((a) => {
    const mark = a.active ? "●" : " ";
    const t = parseInt(a.turns, 10) || 0;
    const n = parseInt(a.tools, 10) || 0;
    const counts = t || n ? `${t}↻ ${n}⚙` : "·";
    return [
      `${mark} ${truncate(a.label, 18).padEnd(18)}`,
      padVisible(truncate(agentStatus(a), 22), 22),
      counts.padStart(8),
      formatRuntime(a.start, a.end).padStart(6),
      formatTokens(a.tokens).padStart(7),
    ].join("  ");
  });
  const choice = await ctx.ui.select("Switch to agent:", labels);
  if (!choice) return;

  const target = agents[labels.indexOf(choice)];
  if (!target || target.active) return;

  // Selecting another pane auto-unzooms; re-zoom the target so we land full-screen.
  await tmux(pi, ["select-pane", "-t", target.id]);
  await tmux(pi, ["resize-pane", "-Z", "-t", target.id]);
}

// ─── kill (close an agent) ──────────────────────────────────────────────────────

async function killAgent(pi: ExtensionAPI, ctx: any) {
  const pane = myPane();
  if (!pane) {
    ctx.ui.notify("Agent groups need a tmux session.", "error");
    return;
  }

  // Only other agents — close the current one with pi's own /exit (or Ctrl+D).
  const others = (await listAgents(pi, pane)).filter((a) => !a.active);
  if (others.length === 0) {
    ctx.ui.notify("No other agents to close (use /exit to close this one).", "info");
    return;
  }

  const labels = others.map((a) => truncate(a.label, 60));
  const choice = await ctx.ui.select("Close which agent?", labels);
  if (!choice) return;

  const target = others[labels.indexOf(choice)];
  if (!target) return;

  await tmux(pi, ["kill-pane", "-t", target.id]); // also drops its @pi_* options
  await tmux(pi, ["resize-pane", "-Z", "-t", pane]); // stay zoomed on ourselves
  ctx.ui.notify(`Closed agent: ${target.label}`, "info");
  void refreshStatus(pi);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Right-pad to `width` *visible columns* (astral glyphs like 🔔 render 2 wide).
function padVisible(s: string, width: number): string {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
  return w >= width ? s : s + " ".repeat(width - w);
}

// One-line summary of what an agent is currently doing.
function agentStatus(a: Agent): string {
  if (a.state === "working") return a.tool ? `⚙ ${a.tool}` : "⚙ working";
  if (a.finished) return "🔔 done";
  return a.active ? "idle" : "needs you"; // idle background agents are waiting on you
}

function formatRuntime(start: string, end: string): string {
  const s = parseInt(start, 10);
  if (!Number.isFinite(s)) return "";
  const e = end ? parseInt(end, 10) : Date.now();
  const secs = Math.max(0, Math.round((e - s) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  return m < 60 ? `${m}m${secs % 60}s` : `${Math.floor(m / 60)}h${m % 60}m`;
}

function formatTokens(raw: string): string {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ─── activity publishing (each agent advertises what it's doing) ─────────────────

async function publish(pi: ExtensionAPI, opts: Record<string, string>) {
  const pane = myPane();
  if (!pane) return;
  for (const [key, value] of Object.entries(opts)) {
    await tmux(pi, ["set-option", "-p", "-t", pane, key, value]);
  }
}

function tokensUsed(): string {
  try {
    const usage = currentCtx?.getContextUsage?.();
    if (usage && usage.tokens != null) return String(usage.tokens);
  } catch {
    /* not available yet */
  }
  return "";
}

function toolHint(event: any): string {
  const name = event?.toolName || "tool";
  const args = event?.args ?? {};
  const detail = args.file_path || args.path || args.command || args.pattern || args.query || "";
  const hint = typeof detail === "string" ? detail.replace(/\s+/g, " ").trim() : "";
  return hint ? `${name}: ${truncate(hint, 28)}` : name;
}

// ─── "agent finished" notifications (shared state in tmux pane options) ──────────
//
// The "finished but unseen" flag lives in each pane's `@pi_finished` tmux option,
// so it's shared across processes and cleaned up automatically when a pane dies.
// Acknowledgement is by *focus*: whichever pane you're looking at clears its own
// flag, so the ping goes away no matter how you switched (←, /switch, or tmux keys).

// Called in the finishing agent's own process when its loop ends.
async function announceFinished(pi: ExtensionAPI) {
  const pane = myPane();
  if (!pane) return; // only meaningful for grouped (tmux) agents

  // If you're already watching this pane, there's nothing to flag.
  const active = await tmux(pi, ["display-message", "-p", "-t", pane, "#{pane_active}"]);
  if (active.code === 0 && active.stdout.trim() === "1") return;

  await tmux(pi, ["set-option", "-p", "-t", pane, FINISHED_OPT, "1"]);
}

// Polled in every process: the attended pane acknowledges itself, and fires a
// one-shot toast (`ctx.ui.notify`) for each *other* pane that just finished.
async function refreshStatus(pi: ExtensionAPI) {
  const pane = myPane();
  if (!pane || !currentCtx) return;

  const active = await tmux(pi, ["display-message", "-p", "-t", pane, "#{pane_active}"]);
  if (!(active.code === 0 && active.stdout.trim() === "1")) return; // only the attended pane reports

  // You're looking at this pane → it's seen.
  await tmux(pi, ["set-option", "-p", "-t", pane, FINISHED_OPT, ""]);

  const r = await tmux(pi, [
    "list-panes",
    "-t",
    pane,
    "-F",
    `#{pane_id}\t#{${AGENT_OPT}}\t#{${FINISHED_OPT}}`,
  ]);
  if (r.code !== 0) return;

  const stillFinished = new Set<string>();
  for (const line of r.stdout.trim().split("\n")) {
    if (!line) continue;
    const [id, label, fin] = line.split("\t");
    if (id === pane || fin !== "1") continue;
    stillFinished.add(id);
    if (!notified.has(id)) {
      notified.add(id); // toast exactly once per finish
      currentCtx.ui.notify(`🔔 ${truncate(label || "agent", 40)} finished`, "info");
    }
  }
  // A pane whose flag has cleared (you visited it) can notify again next time.
  for (const id of notified) if (!stillFinished.has(id)) notified.delete(id);
}

// ─── extension entry ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("spawn", {
    description: "Spawn another agent on this problem (optionally seeded: /spawn <task>)",
    handler: async (args: string, ctx: any) => {
      await spawnAgent(pi, ctx, args ?? "");
    },
  });

  pi.registerCommand("switch", {
    description: "Pick another agent in this group and zoom into it",
    handler: async (_args: string, ctx: any) => {
      await openSwitcher(pi, ctx);
    },
  });

  pi.registerCommand("kill", {
    description: "Close another agent in this group",
    handler: async (_args: string, ctx: any) => {
      await killAgent(pi, ctx);
    },
  });

  // Publish what this agent is doing into its pane options, for the switcher.
  pi.on("agent_start", () => {
    runTurns = 0; // turns are per-run; tool calls accumulate over the agent's life
    void publish(pi, {
      [STATE_OPT]: "working",
      [TOOL_OPT]: "",
      [START_OPT]: String(Date.now()),
      [END_OPT]: "",
      [TURNS_OPT]: "0",
      [TOKENS_OPT]: tokensUsed(),
    });
  });
  pi.on("turn_start", (e: any) => {
    runTurns = (e?.turnIndex ?? runTurns) + 1;
    void publish(pi, { [STATE_OPT]: "working", [TURNS_OPT]: String(runTurns), [TOKENS_OPT]: tokensUsed() });
  });
  pi.on("tool_execution_start", (e: any) => {
    runTools++;
    void publish(pi, { [STATE_OPT]: "working", [TOOL_OPT]: toolHint(e), [TOOLS_OPT]: String(runTools) });
  });
  pi.on("tool_execution_end", () => void publish(pi, { [TOOL_OPT]: "" }));

  // When an agent's loop ends: mark idle, clear tool, flag its pane finished-unseen.
  pi.on("agent_end", () => {
    void publish(pi, {
      [STATE_OPT]: "idle",
      [TOOL_OPT]: "",
      [END_OPT]: String(Date.now()),
      [TOKENS_OPT]: tokensUsed(),
    });
    void announceFinished(pi);
  });

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx; // keep a fresh ctx for the ping widget
    const pane = myPane();

    // Poll focus so the attended pane keeps the statusline ping in sync (acknowledge
    // on focus, drop entries for closed agents). One timer per process.
    //
    // `pi` is captured at extension-load and goes stale when the session is replaced
    // (/new, fork, switch). On reload the module re-evaluates and starts a *fresh*
    // timer, but this closure's timer keeps firing with the now-stale `pi`. Catch the
    // stale-ctx error and clear ourselves so the orphaned timer dies instead of
    // crashing the process with an unhandled rejection.
    if (pane && !statusTimer) {
      statusTimer = setInterval(() => {
        refreshStatus(pi).catch((err) => {
          if (String(err?.message ?? err).includes("stale")) {
            if (statusTimer) clearInterval(statusTimer);
            statusTimer = undefined;
          }
        });
      }, 700);
      statusTimer.unref?.();
    }
    void refreshStatus(pi);
    void publish(pi, { [STATE_OPT]: "idle", [TOKENS_OPT]: tokensUsed() }); // initial activity

    // A freshly spawned, seeded agent: label its pane and kick off the task.
    const seed = process.env[SEED_ENV];
    if (seed) {
      delete process.env[SEED_ENV]; // consume once; survive reloads
      if (pane) void tagPane(pi, pane, seed);
      // Kick off the task once the agent is idle and ready to take a turn.
      let tries = 0;
      const fire = () => {
        try {
          pi.sendUserMessage(seed);
        } catch {
          if (tries++ < 10) setTimeout(fire, 250);
        }
      };
      setTimeout(fire, 150);
    } else if (pane) {
      // First time we see an untagged pane (e.g. the original one): name it after
      // the worktree so it shows up in the switcher.
      void (async () => {
        if (await paneLabel(pi, pane)) return;
        const root = await repoRoot(pi, ctx.cwd);
        await tagPane(pi, pane, root.split("/").pop() || "agent");
      })();
    }

    // Tap raw input for the ← switcher. Coexists with other editors (e.g.
    // paste-detector) — we only consume ← when the editor is empty, so with any
    // text in the box ← stays normal cursor movement. Tear down any previous tap
    // first (including one left over from a pre-reload module instance) so exactly
    // one tap, bound to the current ctx, is ever live.
    priorInputTap()?.();
    setInputTap(
      ctx.ui.onTerminalInput((data: string) => {
        if (LEFT_ARROW.includes(data) && ctx.ui.getEditorText().trim() === "") {
          // Swallow stale-ctx errors: an orphaned tap from a replaced session may
          // still hold a stale `pi`. Don't let it crash the process.
          openSwitcher(pi, ctx).catch(() => {});
          return { consume: true };
        }
        return undefined; // pass everything else through to the editor
      }),
    );
  });
}
