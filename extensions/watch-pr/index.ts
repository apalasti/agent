/**
 * Watch PR Extension - Watches an Azure DevOps pull request for build failures
 * and unresolved review comments, then deploys the agent to fix them.
 *
 * Usage:
 *   /watch-pr <pr-url> [interval-seconds]     watch a specific PR
 *   /watch-pr <repo-url> [interval-seconds]   pick from the repo's active PRs
 *   /watch-pr [interval-seconds]              pick from the current repo's active PRs
 *   /watch-pr status                          list watched PRs
 *   /watch-pr stop [pr-id|all]                stop watching
 *
 * Auth: uses the Azure CLI session (run `az login` once). An AAD access token
 * for the Azure DevOps resource is fetched via `az account get-access-token`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Container, Loader, SelectList, Spacer, Text, type SelectItem } from "@earendil-works/pi-tui";
import { getSelectListTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileP = promisify(execFile);

// ─── types ────────────────────────────────────────────────────────────────────

interface RepoRef {
  org: string;
  project: string;
  repo: string;
  // Home AAD tenant of the org, discovered on the first API call. Cached so
  // later calls reuse the correct tenant-scoped token.
  tenant?: string;
}

interface PrRef extends RepoRef {
  prId: number;
}

interface PrSummary {
  prId: number;
  title: string;
  by: string;
  src: string;
  isDraft: boolean;
}

interface Watch extends PrRef {
  key: string;
  intervalMs: number;
  handle: ReturnType<typeof setInterval> | null;
  projectId: string | null;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  seenBuilds: Set<string>;
  seenStatuses: Set<string>;
  seenComments: Set<string>;
  baselined: boolean;
  polling: boolean;
  ctx: any;
}

interface FixItem {
  kind: "build" | "status" | "comment";
  text: string;
}

const API_VERSION = "7.1";
const DEFAULT_INTERVAL_SECONDS = 60;

// ─── url parsing ────────────────────────────────────────────────────────────────

function parseRepoUrl(raw: string): RepoRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const gitIdx = parts.findIndex((p) => p === "_git");
  if (gitIdx === -1) return null;

  const repo = parts[gitIdx + 1];
  if (!repo) return null;

  // dev.azure.com/{org}/{project}/_git/{repo}   -> org is the first path segment
  // {org}.visualstudio.com/{project}/_git/{repo} -> org is the host subdomain
  let org: string;
  let projectSegments: string[];
  if (url.hostname === "dev.azure.com") {
    org = parts[0];
    projectSegments = parts.slice(1, gitIdx);
  } else if (url.hostname.endsWith(".visualstudio.com")) {
    org = url.hostname.split(".")[0]!;
    projectSegments = parts.slice(0, gitIdx);
  } else {
    return null;
  }

  const project = projectSegments.join("/");
  if (!org || !project) return null;

  return { org, project, repo };
}

function parsePrUrl(raw: string): PrRef | null {
  const repo = parseRepoUrl(raw);
  if (!repo) return null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const prIdx = parts.findIndex((p) => p.toLowerCase() === "pullrequest");
  if (prIdx === -1) return null;

  const prId = parseInt(parts[prIdx + 1] ?? "", 10);
  if (isNaN(prId)) return null;

  return { ...repo, prId };
}

// Parse an Azure DevOps git remote (https or ssh) into a repo reference.
function parseRemote(remote: string): RepoRef | null {
  const trimmed = remote.trim().replace(/\.git$/, "");
  if (trimmed.startsWith("http")) return parseRepoUrl(trimmed);
  // ssh forms: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  //            {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}
  const m = trimmed.match(/[:/]v3\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (m) return { org: m[1]!, project: decodeURIComponent(m[2]!), repo: m[3]! };
  return null;
}

async function inferRepoFromGit(pi: ExtensionAPI, cwd: string): Promise<RepoRef | null> {
  try {
    const list = await pi.exec("git", ["remote"], { cwd });
    if (list.code !== 0) return null;
    const names = list.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return null;

    // The current branch's upstream remote is where the PR most likely lives.
    let tracking: string | null = null;
    const up = await pi.exec(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { cwd },
    );
    if (up.code === 0) {
      const slash = up.stdout.trim().indexOf("/");
      const cand = slash > 0 ? up.stdout.trim().slice(0, slash) : "";
      if (names.includes(cand)) tracking = cand;
    }

    // Order: tracked remote, then origin, then the rest. Return the first Azure one.
    const ordered: string[] = [];
    for (const n of [tracking, "origin", ...names]) {
      if (n && names.includes(n) && !ordered.includes(n)) ordered.push(n);
    }
    for (const name of ordered) {
      const res = await pi.exec("git", ["remote", "get-url", name], { cwd });
      if (res.code !== 0) continue;
      const ref = parseRemote(res.stdout.trim());
      if (ref) return ref;
    }
    return null;
  } catch {
    return null;
  }
}

function prWebUrl(w: PrRef): string {
  return `https://dev.azure.com/${w.org}/${encodeURIComponent(w.project)}/_git/${encodeURIComponent(w.repo)}/pullrequest/${w.prId}`;
}

// ─── azure devops rest api ──────────────────────────────────────────────────────

// Azure DevOps AAD resource id — tokens for this resource authenticate REST calls.
const AZDO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";

// One token per AAD tenant. Different Azure DevOps orgs can be backed by
// different tenants, so we cache tokens keyed by the tenant they were issued for.
const tokenCache = new Map<string, { token: string; expMs: number }>();

async function getAccessToken(tenant?: string): Promise<string> {
  const key = tenant ?? "default";
  const cached = tokenCache.get(key);
  if (cached && cached.expMs - Date.now() > 120_000) return cached.token;

  const args = ["account", "get-access-token", "--resource", AZDO_RESOURCE, "-o", "json"];
  if (tenant) args.push("--tenant", tenant);
  let stdout: string;
  try {
    const r = await execFileP("az", args, { timeout: 30_000 });
    stdout = r.stdout;
  } catch (err: any) {
    const detail = String(err?.stderr || err?.message || err).trim();
    const hint = tenant ? `run \`az login --tenant ${tenant}\`` : "run `az login`";
    throw new Error(`could not get an Azure DevOps token via az — ${hint} (${detail})`);
  }
  const j = JSON.parse(stdout);
  const expMs = j.expires_on ? Number(j.expires_on) * 1000 : Date.parse(j.expiresOn);
  const entry = {
    token: j.accessToken,
    expMs: Number.isFinite(expMs) ? expMs : Date.now() + 300_000,
  };
  tokenCache.set(key, entry);
  return entry.token;
}

// Azure DevOps answers an unauthenticated/wrong-tenant API call with an HTML
// sign-in page (often HTTP 200/203) rather than a clean 401. Treat any non-JSON
// body as "signed out".
function looksSignedOut(res: Response): boolean {
  if (res.status === 401 || res.status === 203) return true;
  const ct = res.headers.get("content-type") ?? "";
  return res.ok && !ct.includes("json");
}

function resourceTenant(res: Response): string | undefined {
  return res.headers.get("x-vss-resourcetenant")?.split(",")[0]?.trim() || undefined;
}

async function azGet<T = any>(
  w: { org: string; project: string; tenant?: string },
  path: string,
  query = "",
  apiVersion: string = API_VERSION,
): Promise<T> {
  const base = `https://dev.azure.com/${w.org}/${encodeURIComponent(w.project)}/_apis/`;
  const sep = query ? "&" : "";
  const url = `${base}${path}?api-version=${apiVersion}${sep}${query}`;
  const doFetch = (tok: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" } });

  let res = await doFetch(await getAccessToken(w.tenant));

  if (looksSignedOut(res)) {
    const tenant = resourceTenant(res);
    // The org lives in a different AAD tenant than our default token — get a
    // token scoped to that tenant and retry once.
    if (tenant && tenant !== w.tenant) {
      try {
        const tok = await getAccessToken(tenant);
        w.tenant = tenant; // reuse for the rest of this session
        res = await doFetch(tok);
      } catch (e: any) {
        throw new Error(
          `Azure DevOps org ${w.org} is in AAD tenant ${tenant}, which az can't issue a ` +
            `token for — run \`az login --tenant ${tenant}\` (or \`az login\` with an account ` +
            `in that tenant). (${e?.message ?? e})`,
        );
      }
    }
    if (looksSignedOut(res)) {
      const t = resourceTenant(res);
      throw new Error(
        `auth rejected (HTTP ${res.status}) by Azure DevOps for ${w.org}` +
          (t
            ? ` — its AAD tenant is ${t}; try \`az login --tenant ${t}\``
            : " — ensure `az login` is done and your account can access this org") +
          ".",
      );
    }
  }
  if (!res.ok) {
    throw new Error(`Azure DevOps API ${res.status} for ${path}`);
  }
  return res.json() as Promise<T>;
}

async function listActivePrs(repo: RepoRef): Promise<PrSummary[]> {
  const res = await azGet<any>(
    repo,
    `git/repositories/${encodeURIComponent(repo.repo)}/pullRequests`,
    "searchCriteria.status=active&$top=50",
  );
  return (res.value ?? []).map((pr: any) => ({
    prId: pr.pullRequestId,
    title: pr.title ?? `PR #${pr.pullRequestId}`,
    by: pr.createdBy?.displayName ?? "unknown",
    src: (pr.sourceRefName ?? "").replace(/^refs\/heads\//, ""),
    isDraft: !!pr.isDraft,
  }));
}

// Native-looking, live type-to-filter PR picker. Mirrors the chrome of the
// built-in selectors (bordered panel + accent title + hint line) but wraps a
// SelectList whose filtering we drive ourselves (multi-token match across
// id/title/author/branch, which SelectList's own startsWith filter can't do).
class PrPickerComponent extends Container {
  private readonly list: SelectList;
  private readonly items: SelectItem[];
  private readonly hay: string[];
  private readonly search: Text;
  private readonly theme: any;
  private query = "";
  private finished = false;

  constructor(theme: any, repo: RepoRef, prs: PrSummary[], done: (r: string | undefined) => void) {
    super();
    this.theme = theme;
    this.items = prs.map((p) => ({
      value: String(p.prId),
      label: `#${p.prId}${p.isDraft ? " [draft]" : ""}  ${p.title}`,
      description: `${p.by} · ${p.src}`,
    }));
    this.hay = prs.map((p) => `#${p.prId} ${p.title} ${p.by} ${p.src}`.toLowerCase());

    const border = () => ({
      render: (w: number) => [theme.fg("border", "─".repeat(Math.max(1, w)))],
    });

    this.list = new SelectList(this.items, 12, getSelectListTheme(), {
      minPrimaryColumnWidth: 12,
      maxPrimaryColumnWidth: 48,
    });
    this.list.onSelect = (item) => {
      this.finished = true;
      done(item.value);
    };
    this.list.onCancel = () => {
      this.finished = true;
      done(undefined);
    };
    this.search = new Text(this.searchLine(), 1, 0);

    this.addChild(border());
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold(`Watch a PR in ${repo.repo}`)), 1, 0));
    this.addChild(this.search);
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(theme.fg("muted", "type to filter · ↑↓ navigate · ⏎ select · esc cancel"), 1, 0),
    );
    this.addChild(new Spacer(1));
    this.addChild(border());
  }

  private searchLine(): string {
    return this.query
      ? this.theme.fg("muted", "search: ") + this.theme.fg("accent", this.query)
      : this.theme.fg("muted", "search: (type to filter)");
  }

  private applyFilter(): void {
    const tokens = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = tokens.length
      ? this.items.filter((_it, i) => tokens.every((t) => this.hay[i]!.includes(t)))
      : this.items;
    (this.list as any).filteredItems = filtered;
    (this.list as any).selectedIndex = 0;
  }

  handleInput(data: string): void {
    if (this.finished) return;
    if (data === "\x7f" || data === "\b") {
      this.query = this.query.slice(0, -1);
      this.applyFilter();
      this.search.setText(this.searchLine());
    } else if (data.length === 1 && data >= " ") {
      this.query += data;
      this.applyFilter();
      this.search.setText(this.searchLine());
    } else {
      this.list.handleInput(data);
    }
  }
}

// Show an animated spinner (or a footer status when no widget area is available)
// while an async fetch is in flight, then clear it.
async function withLoader<T>(ctx: any, message: string, fn: () => Promise<T>): Promise<T> {
  const key = "watch-pr-loading";
  const canWidget = ctx.mode === "tui" && typeof ctx.ui.setWidget === "function";
  if (canWidget) {
    ctx.ui.setWidget(key, (tui: any, theme: any) => {
      const loader = new Loader(
        tui,
        (s: string) => theme.fg("accent", s),
        (s: string) => theme.fg("muted", s),
        message,
      );
      (loader as any).dispose = () => loader.stop();
      return loader;
    });
  } else {
    ctx.ui.setStatus?.(key, message);
  }
  try {
    return await fn();
  } finally {
    if (canWidget) ctx.ui.setWidget(key, undefined);
    else ctx.ui.setStatus?.(key, undefined);
  }
}

function pickPrInteractive(
  ctx: any,
  repo: RepoRef,
  prs: PrSummary[],
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>(
    (_tui: any, theme: any, _kb: any, done: (r: string | undefined) => void) =>
      new PrPickerComponent(theme, repo, prs, done),
  );
}

// ─── data collection ────────────────────────────────────────────────────────────

async function loadPrMeta(w: Watch): Promise<void> {
  const pr = await azGet<any>(w, `git/repositories/${encodeURIComponent(w.repo)}/pullRequests/${w.prId}`);
  w.title = pr.title ?? `PR #${w.prId}`;
  w.sourceBranch = (pr.sourceRefName ?? "").replace(/^refs\/heads\//, "");
  w.targetBranch = (pr.targetRefName ?? "").replace(/^refs\/heads\//, "");
  w.projectId = pr.repository?.project?.id ?? null;
}

async function collectFailedBuilds(w: Watch): Promise<FixItem[]> {
  if (!w.projectId) return [];

  const artifactId = `vstfs:///CodeReview/CodeReviewId/${w.projectId}/${w.prId}`;
  let evals: any;
  try {
    // The policy/evaluations endpoint is only exposed under the -preview api-version.
    evals = await azGet<any>(
      w,
      "policy/evaluations",
      `artifactId=${encodeURIComponent(artifactId)}`,
      "7.1-preview.1",
    );
  } catch {
    return [];
  }

  const items: FixItem[] = [];
  for (const ev of evals.value ?? []) {
    const type = ev.configuration?.type?.displayName;
    if (type !== "Build") continue;
    if (ev.status !== "rejected") continue;

    const buildId = ev.context?.buildId;
    if (buildId == null) continue;
    // Skip superseded builds — a newer iteration has replaced them.
    if (ev.context?.isExpired) continue;

    const dedupeKey = `${buildId}`;
    if (w.seenBuilds.has(dedupeKey)) continue;
    w.seenBuilds.add(dedupeKey);

    const buildUrl = `https://dev.azure.com/${w.org}/${encodeURIComponent(w.project)}/_build/results?buildId=${buildId}`;
    const errors = await collectBuildErrors(w, buildId);
    const label = ev.configuration?.settings?.displayName ?? "Build validation";

    let text = `Build ${buildId} (${label}) failed — ${buildUrl}`;
    if (errors.length) {
      text += "\n  Errors:\n" + errors.map((e) => `    - ${e}`).join("\n");
    }
    items.push({ kind: "build", text });
  }
  return items;
}

async function collectBuildErrors(w: Watch, buildId: number): Promise<string[]> {
  try {
    const timeline = await azGet<any>(w, `build/builds/${buildId}/timeline`);
    const errors: string[] = [];
    for (const rec of timeline.records ?? []) {
      for (const issue of rec.issues ?? []) {
        if (issue.type === "error" && issue.message) {
          const where = rec.name ? `${rec.name}: ` : "";
          errors.push(`${where}${issue.message}`.replace(/\s+/g, " ").trim());
        }
      }
    }
    return errors.slice(0, 25);
  } catch {
    return [];
  }
}

async function collectFailedStatuses(w: Watch): Promise<FixItem[]> {
  let res: any;
  try {
    res = await azGet<any>(w, `git/repositories/${encodeURIComponent(w.repo)}/pullRequests/${w.prId}/statuses`);
  } catch {
    return [];
  }

  const items: FixItem[] = [];
  for (const s of res.value ?? []) {
    if (s.state !== "failed" && s.state !== "error") continue;

    const name = [s.context?.genre, s.context?.name].filter(Boolean).join("/");
    const dedupeKey = `${name}:${s.description ?? ""}`;
    if (w.seenStatuses.has(dedupeKey)) continue;
    w.seenStatuses.add(dedupeKey);

    let text = `Status "${name}" is ${s.state}: ${s.description ?? ""}`.trim();
    if (s.targetUrl) text += `\n  ${s.targetUrl}`;
    items.push({ kind: "status", text });
  }
  return items;
}

async function collectUnresolvedComments(w: Watch): Promise<FixItem[]> {
  let res: any;
  try {
    res = await azGet<any>(w, `git/repositories/${encodeURIComponent(w.repo)}/pullRequests/${w.prId}/threads`);
  } catch {
    return [];
  }

  const items: FixItem[] = [];
  for (const thread of res.value ?? []) {
    // Only unresolved discussion threads.
    if (thread.status !== "active" && thread.status !== "pending") continue;

    const humanComments = (thread.comments ?? []).filter(
      (c: any) => c.commentType !== "system" && c.content,
    );
    if (humanComments.length === 0) continue;

    const last = humanComments[humanComments.length - 1];
    const dedupeKey = `${thread.id}:${last.id}`;
    if (w.seenComments.has(dedupeKey)) continue;
    w.seenComments.add(dedupeKey);

    const fileCtx = thread.threadContext;
    const loc = fileCtx?.filePath
      ? `${fileCtx.filePath}${fileCtx.rightFileStart?.line ? `:${fileCtx.rightFileStart.line}` : ""}`
      : "general";
    const author = last.author?.displayName ?? "reviewer";
    const content = String(last.content).replace(/\s+/g, " ").trim();

    items.push({ kind: "comment", text: `[${loc}] ${author}: ${content} (thread ${thread.id})` });
  }
  return items;
}

// ─── fix dispatch ───────────────────────────────────────────────────────────────

function buildFixPrompt(w: Watch, items: FixItem[]): string {
  const builds = items.filter((i) => i.kind === "build").map((i) => i.text);
  const statuses = items.filter((i) => i.kind === "status").map((i) => i.text);
  const comments = items.filter((i) => i.kind === "comment").map((i) => i.text);

  const lines: string[] = [];
  lines.push(`The Azure DevOps pull request "${w.title}" (#${w.prId}) has issues that need fixing.`);
  lines.push("");
  lines.push(`PR: ${prWebUrl(w)}`);
  lines.push(`Source branch: ${w.sourceBranch || "?"}   Target branch: ${w.targetBranch || "?"}`);
  lines.push("");

  if (builds.length) {
    lines.push("## Failed builds");
    for (const b of builds) lines.push(`- ${b}`);
    lines.push("");
  }
  if (statuses.length) {
    lines.push("## Failed status checks");
    for (const s of statuses) lines.push(`- ${s}`);
    lines.push("");
  }
  if (comments.length) {
    lines.push("## Unresolved review comments");
    for (const c of comments) lines.push(`- ${c}`);
    lines.push("");
  }

  lines.push("Please:");
  lines.push(
    `1. Make sure this repo checkout is on the PR source branch \`${w.sourceBranch || "the PR branch"}\`. ` +
      "Fetch and check it out if needed.",
  );
  lines.push("2. Investigate and fix the build errors and address each review comment.");
  lines.push("3. Build and run the tests locally to verify the fixes.");
  lines.push("4. Commit and push to the source branch so the pull request updates.");

  return lines.join("\n");
}

function timestamp(): string {
  return new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

async function poll(pi: ExtensionAPI, w: Watch): Promise<void> {
  if (w.polling) return;
  w.polling = true;
  const firstRun = !w.baselined;
  try {
    if (!w.projectId || !w.title) {
      await loadPrMeta(w);
    }

    const items = [
      ...(await collectFailedBuilds(w)),
      ...(await collectFailedStatuses(w)),
      ...(await collectUnresolvedComments(w)),
    ];

    try {
      w.ctx.ui.setStatus("watch-pr", `PR #${w.prId} · checked ${timestamp()} · ${items.length} new`);
    } catch {}

    if (items.length === 0) {
      if (firstRun) {
        try {
          w.ctx.ui.notify(
            `watch-pr: PR #${w.prId} has no open build errors or comments right now — watching every ${w.intervalMs / 1000}s.`,
            "info",
          );
        } catch {}
      }
      return;
    }

    const prompt = buildFixPrompt(w, items);
    try {
      w.ctx.ui.notify(
        `watch-pr: PR #${w.prId} has ${items.length} new issue(s) — dispatching a fix.`,
        "warning",
      );
    } catch {}
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  } catch (err) {
    try {
      w.ctx.ui.notify(`watch-pr: poll failed for PR #${w.prId}: ${String(err)}`, "error");
    } catch {}
  } finally {
    w.baselined = true;
    w.polling = false;
  }
}

// ─── extension ──────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const watches = new Map<string, Watch>();

  function refreshStatus() {
    const first = watches.values().next().value as Watch | undefined;
    if (!first) return;
    const label =
      watches.size === 1
        ? `watching PR #${first.prId}`
        : `watching ${watches.size} PRs`;
    try {
      first.ctx.ui.setStatus("watch-pr", label);
    } catch {}
  }

  function stopWatch(w: Watch) {
    if (w.handle) clearInterval(w.handle);
    watches.delete(w.key);
    try {
      w.ctx.ui.setStatus("watch-pr", undefined);
    } catch {}
  }

  async function startWatch(ctx: any, ref: PrRef, intervalSeconds: number): Promise<void> {
    const key = `${ref.org}/${ref.project}/${ref.repo}/${ref.prId}`;
    if (watches.has(key)) {
      ctx.ui.notify(`watch-pr: already watching PR #${ref.prId}.`, "info");
      return;
    }

    const w: Watch = {
      ...ref,
      key,
      intervalMs: intervalSeconds * 1000,
      handle: null,
      projectId: null,
      title: "",
      sourceBranch: "",
      targetBranch: "",
      seenBuilds: new Set(),
      seenStatuses: new Set(),
      seenComments: new Set(),
      baselined: false,
      polling: false,
      ctx,
    };
    watches.set(key, w);

    try {
      await withLoader(ctx, `Loading PR #${ref.prId}…`, () => loadPrMeta(w));
    } catch (err) {
      watches.delete(key);
      ctx.ui.notify(`watch-pr: could not reach the PR — ${String(err)}`, "error");
      return;
    }

    ctx.ui.notify(
      `watch-pr: watching "${w.title}" (#${w.prId}) every ${intervalSeconds}s. First check running now.`,
      "info",
    );
    refreshStatus();

    // Run an immediate check, then poll on an interval.
    void poll(pi, w);
    w.handle = setInterval(() => void poll(pi, w), w.intervalMs);
  }

  async function selectAndWatch(ctx: any, repo: RepoRef, intervalSeconds: number): Promise<void> {
    if (!ctx.hasUI) {
      ctx.ui.notify(
        "watch-pr: pass a full PR URL — interactive selection needs a UI (not available in this mode).",
        "error",
      );
      return;
    }

    let prs: PrSummary[];
    try {
      prs = await withLoader(ctx, `Loading active PRs in ${repo.repo}…`, () =>
        listActivePrs(repo),
      );
    } catch (err) {
      ctx.ui.notify(`watch-pr: could not list PRs for ${repo.repo} — ${String(err)}`, "error");
      return;
    }
    if (prs.length === 0) {
      ctx.ui.notify(`watch-pr: no active PRs in ${repo.repo}.`, "info");
      return;
    }

    let chosen: PrSummary | undefined;
    if (ctx.mode === "tui") {
      const val = await pickPrInteractive(ctx, repo, prs);
      if (val === undefined) return;
      chosen = prs.find((p) => String(p.prId) === val);
    } else {
      // Non-TUI (e.g. RPC): no custom component, fall back to a plain selector.
      const labels = prs.map(
        (p) => `#${p.prId}${p.isDraft ? " [draft]" : ""}  ${p.title} — ${p.by} (${p.src})`,
      );
      const choice = await ctx.ui.select(`Active PRs in ${repo.repo} — pick one to watch`, labels);
      if (!choice) return;
      chosen = prs[labels.indexOf(choice)];
    }
    if (!chosen) return;
    await startWatch(ctx, { ...repo, prId: chosen.prId }, intervalSeconds);
  }

  pi.registerCommand("watch-pr", {
    description: "Watch an Azure DevOps PR for build errors and comments, and auto-fix them",
    handler: async (args: string, ctx: any) => {
      const argv = args.trim().split(/\s+/).filter(Boolean);
      const sub = argv[0]?.toLowerCase();

      if (sub === "status" || sub === "list") {
        if (watches.size === 0) {
          ctx.ui.notify("watch-pr: not watching any PRs.", "info");
          return;
        }
        const lines = [...watches.values()].map(
          (w) => `#${w.prId} ${w.title || w.repo} — every ${w.intervalMs / 1000}s`,
        );
        ctx.ui.notify(`watch-pr watching:\n${lines.join("\n")}`, "info");
        return;
      }

      if (sub === "stop") {
        const target = argv[1]?.toLowerCase();
        if (!target || target === "all") {
          for (const w of [...watches.values()]) stopWatch(w);
          ctx.ui.notify("watch-pr: stopped watching all PRs.", "info");
          return;
        }
        const match = [...watches.values()].find((w) => String(w.prId) === target);
        if (!match) {
          ctx.ui.notify(`watch-pr: not watching PR #${target}.`, "warning");
          return;
        }
        stopWatch(match);
        ctx.ui.notify(`watch-pr: stopped watching PR #${target}.`, "info");
        return;
      }

      try {
        await getAccessToken();
      } catch (err) {
        ctx.ui.notify(`watch-pr: ${String(err instanceof Error ? err.message : err)}`, "error");
        return;
      }

      const urlArg = argv.find((a) => a.includes("://"));
      const numArg = argv.find((a) => /^\d+$/.test(a));
      const intervalSeconds = Math.max(15, parseInt(numArg ?? "", 10) || DEFAULT_INTERVAL_SECONDS);

      // Full PR URL -> watch it directly.
      if (urlArg) {
        const prRef = parsePrUrl(urlArg);
        if (prRef) {
          await startWatch(ctx, prRef, intervalSeconds);
          return;
        }
        // A repo-level Azure DevOps URL -> list its PRs to choose from.
        const repoRef = parseRepoUrl(urlArg);
        if (!repoRef) {
          ctx.ui.notify("watch-pr: could not parse an Azure DevOps URL from the argument.", "error");
          return;
        }
        await selectAndWatch(ctx, repoRef, intervalSeconds);
        return;
      }

      // No URL -> infer the repo from the current git remotes, then list its PRs.
      const inferred = await inferRepoFromGit(pi, ctx.cwd);
      if (!inferred) {
        ctx.ui.notify(
          `watch-pr: no Azure DevOps remote found in ${ctx.cwd}. ` +
            "Run pi from the target repo checkout, or pass a repo/PR URL, e.g.\n" +
            "  /watch-pr https://dev.azure.com/<org>/<project>/_git/<repo>",
          "error",
        );
        return;
      }
      await selectAndWatch(ctx, inferred, intervalSeconds);
    },
  });

  pi.on("session_shutdown", () => {
    for (const w of watches.values()) {
      if (w.handle) clearInterval(w.handle);
    }
    watches.clear();
  });
}
