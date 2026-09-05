/**
 * session-name — every session ends up with a name you can find it by.
 *
 * A name is generated after the first exchange of a new session, and on load
 * for a resumed session that never got one. Names are written as `session_info`
 * entries, so pi's own `/resume` picker and `/name` work unchanged.
 *
 * /rename regenerates the current session's name on demand.
 *
 * Config — ~/.pi/agent/configs/session-name.json:
 *   {
 *     "autoName": "llm" | "heuristic" | "off",
 *     "llmModel": "ollama-cloud/glm-5.3-flash",
 *     "llmMaxWords": 6,
 *     "maxAttempts": 3,
 *     "heuristicMaxLength": 60,
 *     "notifyOnAutoName": true,
 *     "setTitle": true,
 *     "titleFormat": "{summary} — {dir}"
 *   }
 */

import type { Message, Model } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  getPackageDir,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  DEFAULTS,
  buildNamingInput,
  heuristicName,
  parseTitle,
  systemPrompt,
  userPrompt,
  type NamingConfig,
} from "./naming.ts";

// ── Config ────────────────────────────────────────────────────────────────

interface Config {
  autoName: "off" | "heuristic" | "llm";
  llmModel: string | null;
  llmMaxWords: number;
  /** Generation attempts before falling back to the first line of the first prompt. */
  maxAttempts: number;
  heuristicMaxLength: number;
  notifyOnAutoName: boolean;
  setTitle: boolean;
  titleFormat: string;
}

const DEFAULT_CONFIG: Config = {
  autoName: "llm",
  llmModel: "ollama-cloud/glm-5.3-flash",
  llmMaxWords: DEFAULTS.maxWords,
  maxAttempts: 3,
  heuristicMaxLength: DEFAULTS.maxLength,
  notifyOnAutoName: true,
  setTitle: true,
  titleFormat: "{summary} — {dir}",
};

function loadConfig(): Config {
  try {
    const raw = readFileSync(join(getAgentDir(), "configs", "session-name.json"), "utf8");
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<Config>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

const config = loadConfig();
const naming: NamingConfig = {
  ...DEFAULTS,
  maxWords: config.llmMaxWords,
  maxLength: config.heuristicMaxLength,
};

// ── Terminal title ────────────────────────────────────────────────────────

/** Pi's own `APP_TITLE` rule: the manifest name when a distribution rebrands pi. */
function appTitle(): string {
  try {
    const manifest = JSON.parse(readFileSync(join(getPackageDir(), "package.json"), "utf8")) as {
      piConfig?: { name?: unknown };
    };
    const name = manifest.piConfig?.name;
    return typeof name === "string" && name ? name : "π";
  } catch {
    return "π";
  }
}

export function buildTitle(name: string | undefined, cwd: string, format: string): string {
  const dir = basename(cwd) || cwd;
  const app = appTitle();
  if (!name) return `${app} — ${dir}`;
  return format.replace(/\{summary\}/g, name).replace(/\{dir\}/g, dir).replace(/\{app\}/g, app);
}

// ── Extension ─────────────────────────────────────────────────────────────

export default function sessionNameExtension(pi: ExtensionAPI): void {
  let attempts = 0;
  let done = false;
  let inFlight: AbortController | null = null;
  let pendingTitle: ReturnType<typeof setTimeout> | null = null;
  let warnedBadModel = false;
  let lastFailure = "no attempt made";

  /**
   * The name sits in a widget above the editor rather than the footer status,
   * because a custom footer (statusline packages) drops extension statuses.
   */
  function showName(ctx: ExtensionContext, name: string | undefined): void {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget("session-name", name ? [`▸ ${name}`] : undefined, { placement: "aboveEditor" });
    if (config.setTitle) ctx.ui.setTitle(buildTitle(name, ctx.cwd, config.titleFormat));
  }

  /** One generation attempt. Returns a valid title, or null on any failure. */
  async function generate(ctx: ExtensionContext, branch: SessionEntry[]): Promise<string | null> {
    const transcript = buildNamingInput(branch, naming);
    if (!transcript) {
      lastFailure = "no user text to name from";
      return null;
    }

    const model = resolveModel(ctx);
    if (!model) {
      lastFailure = "no model available";
      return null;
    }
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      lastFailure = `no API key for ${model.provider}/${model.id}`;
      return null;
    }

    const provider = ctx.modelRegistry.getProvider(model.provider);
    if (!provider) {
      lastFailure = `no provider ${model.provider}`;
      return null;
    }

    const controller = new AbortController();
    inFlight = controller;
    const message: Message = {
      role: "user",
      content: [{ type: "text", text: userPrompt(transcript) }],
      timestamp: Date.now(),
    };

    try {
      const response = await provider
        .streamSimple(
          model,
          { systemPrompt: systemPrompt(naming), messages: [message] },
          {
            apiKey: auth.apiKey,
            headers: auth.headers,
            env: auth.env,
            signal: controller.signal,
            // GLM leaks its thinking into the reply when reasoning is disabled;
            // left on, the thinking arrives as thinking blocks and the text is clean.
            reasoning: "low",
          },
        )
        .result();
      if (response.stopReason === "error" || response.stopReason === "aborted") {
        lastFailure = `stream ${response.stopReason}: ${response.errorMessage ?? ""}`;
        return null;
      }
      const raw = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const title = parseTitle(raw, naming);
      if (!title) lastFailure = `unusable response: ${JSON.stringify(raw).slice(0, 200)}`;
      return title;
    } catch (error) {
      lastFailure = `threw: ${String(error).slice(0, 200)}`;
      return null;
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  function resolveModel(ctx: ExtensionContext): Model<any> | undefined {
    if (!config.llmModel) return ctx.model;
    const slash = config.llmModel.indexOf("/");
    const found =
      slash > 0
        ? ctx.modelRegistry.find(config.llmModel.slice(0, slash), config.llmModel.slice(slash + 1))
        : undefined;
    if (found) return found;
    if (!warnedBadModel && ctx.hasUI) {
      warnedBadModel = true;
      ctx.ui.notify(`session-name: model "${config.llmModel}" not found; using session model`, "warning");
    }
    return ctx.model;
  }

  /**
   * Try to name the session. Retried on every settled turn until it succeeds;
   * once the attempt budget is spent the heuristic name lands instead, so a
   * session is never left unnamed.
   */
  async function nameSession(ctx: ExtensionContext): Promise<void> {
    if (done || config.autoName === "off") return;
    if (pi.getSessionName()) {
      done = true;
      return;
    }

    const branch = ctx.sessionManager.getBranch();
    let name: string | null = null;

    if (config.autoName === "llm" && attempts < config.maxAttempts) {
      attempts++;
      name = await generate(ctx, branch);
      if (!name && attempts < config.maxAttempts) return; // retry on the next settled turn
    }
    if (!name) name = heuristicName(branch, naming);
    if (!name) return;

    // A /name may have landed while generation was in flight.
    if (pi.getSessionName()) {
      done = true;
      return;
    }

    done = true;
    pi.setSessionName(name);
    if (config.notifyOnAutoName && ctx.hasUI) ctx.ui.notify(`Session named: ${name}`, "info");
  }

  pi.on("session_start", (_event, ctx) => {
    attempts = 0;
    done = false;
    // Deferred so it lands after pi's own startup updateTerminalTitle().
    pendingTitle = setTimeout(() => {
      pendingTitle = null;
      showName(ctx, pi.getSessionName());
      // A resumed session with history but no name gets one before you type.
      if (!pi.getSessionName()) void nameSession(ctx);
    }, 0);
  });

  pi.on("session_info_changed", (event, ctx) => {
    // Naming by hand (/name) wins: never overwrite it, and never re-name a
    // name the user deliberately cleared.
    done = true;
    showName(ctx, event.name);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await nameSession(ctx);
  });

  pi.on("session_shutdown", () => {
    inFlight?.abort();
    inFlight = null;
    if (pendingTitle) clearTimeout(pendingTitle);
    pendingTitle = null;
  });

  pi.registerCommand("rename", {
    description: "Regenerate the session name from its first exchange",
    handler: async (_args, ctx) => {
      ctx.ui.setWidget("session-name", ["▸ naming…"], { placement: "aboveEditor" });
      const branch = ctx.sessionManager.getBranch();
      let name: string | null = null;
      for (let i = 0; i < config.maxAttempts && !name; i++) {
        name = await generate(ctx, branch);
      }
      if (!name) {
        showName(ctx, pi.getSessionName());
        ctx.ui.notify(`Could not generate a name — ${lastFailure}`, "error");
        return;
      }
      pi.setSessionName(name);
      ctx.ui.notify(`Session named: ${name}`, "info");
    },
  });
}
