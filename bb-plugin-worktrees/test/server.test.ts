import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin from "../server";
import { TASK_WORKTREE_PROVIDER_ID, WORKTREES_CHANGED, type ScratchIndex } from "../src/contract";
import { git, makeRepo, write, type TempRepo } from "./repo";

const PROJECT_ID = "proj_demo";
const HOST_ID = "host_local";

let repo: TempRepo;
let environments: { id: string; path: string | null; status: string; lifecycle: { phase: string } }[];

async function load(settings: Record<string, string> = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "worktrees",
    settings,
    sdk: {
      projects: {
        get: async () => ({
          id: PROJECT_ID,
          name: "demo",
          sources: [{ hostId: HOST_ID, path: repo.repo, isDefault: true }],
        }),
        list: async () => [{ id: PROJECT_ID, name: "demo" }],
      },
      system: { config: async () => ({ primaryHostId: HOST_ID }) },
      environments: { list: async () => environments },
      threads: {
        spawn: async () => ({ id: "thr_new" }),
        get: async () => makeThreadResponse({ id: "thr_caller", environmentId: "env_side" }),
        list: async () => [makeThreadResponse({ id: "thr_in_worktree" })],
        archive: async () => ({ ok: true }),
      },
    } as never,
  });
  await plugin(bb);
  await harness.behavior.callRpc("setConfig", { projectId: PROJECT_ID, config: { tool: "git" } });
  return harness;
}

function createContext(pathKey: string, inputs: Record<string, string>, claimed: string[] = []) {
  const logs: string[] = [];
  return {
    logs,
    context: {
      project: { id: PROJECT_ID, name: "demo" },
      host: { id: HOST_ID },
      projectCheckout: { path: repo.repo, experimental_ownsPath: false },
      gitRemote: null,
      inputs,
      thread: makeThreadResponse({ id: "thr_task" }),
      suggestedBranchName: "bb/suggested",
      attempt: 1,
      pathKey,
      experimental_claimPath: async (path: string) => {
        claimed.push(path);
        return true;
      },
      report: { step: (text: string) => logs.push(text), log: (text: string) => logs.push(text) },
      signal: new AbortController().signal,
    },
  };
}

beforeEach(() => {
  repo = makeRepo({ "AGENTS.md": "tracked\n" });
  write(join(repo.repo, ".myscripts", "agents", "AGENTS.md"), "personal\n");
  write(join(repo.repo, ".myscripts", "agents", "CODING_STANDARDS.md"), "standards\n");
  environments = [];
});
afterEach(() => repo.cleanup());

describe("task-worktree provider", () => {
  it("creates a worktree with the overlay, idempotently per pathKey", async () => {
    const harness = await load();
    const provider = harness.registrations.environmentProviders.get(TASK_WORKTREE_PROVIDER_ID)!;
    const claimed: string[] = [];
    const { context } = createContext("pk1", { branch: "feat/a" }, claimed);

    const first = await provider.create(context as never);
    const path = join(repo.root, "demo-worktrees", "feat-a");
    expect(first).toMatchObject({ status: "created", path, ownsPath: false, mergeBaseBranch: "main" });
    expect(claimed).toEqual([path]);
    expect(git(path, "ls-files", "-v", "AGENTS.md").trim()).toBe("S AGENTS.md");
    expect(lstatSync(join(path, "CODING_STANDARDS.md")).isSymbolicLink()).toBe(true);
    expect(harness.realtimeSignals.some((signal) => signal.channel === WORKTREES_CHANGED)).toBe(true);

    const again = await provider.create(context as never);
    expect(again).toMatchObject({ status: "created", path, resource: { createdByUs: true, createdBranch: true } });
  });

  it("falls back to the suggested branch name and refuses invalid branches", async () => {
    const harness = await load();
    const provider = harness.registrations.environmentProviders.get(TASK_WORKTREE_PROVIDER_ID)!;
    expect(await provider.create(createContext("pk2", {}).context as never)).toMatchObject({
      status: "created",
      path: join(repo.root, "demo-worktrees", "bb-suggested"),
    });
    expect(await provider.create(createContext("pk3", { branch: "bad..x" }).context as never)).toMatchObject({
      status: "failed",
    });
  });

  it("cleans up a cancelled launch it created, and leaves attached worktrees alone", async () => {
    const harness = await load();
    const provider = harness.registrations.environmentProviders.get(TASK_WORKTREE_PROVIDER_ID)!;
    const created = (await provider.create(createContext("pk4", { branch: "kept" }).context as never)) as { path: string };
    const report = { step: () => {}, log: () => {} };
    const base = { hostId: HOST_ID, path: created.path, pathKey: "pk4", resource: null, attempt: 1, report, signal: new AbortController().signal };

    expect(await provider.remove({ ...base, environment: { id: "env_1" } } as never)).toEqual({ status: "removed" });
    expect(existsSync(created.path)).toBe(true);

    const cancelled = (await provider.create(createContext("pk5", { branch: "cancelled" }).context as never)) as { path: string };
    expect(await provider.remove({ ...base, pathKey: "pk5", path: null, environment: null } as never)).toEqual({ status: "removed" });
    expect(existsSync(cancelled.path)).toBe(false);
    expect(git(repo.repo, "branch", "--list", "cancelled").trim()).toBe("");
  });
});

describe("rpc", () => {
  it("lists worktrees with their environment ids", async () => {
    const harness = await load();
    git(repo.repo, "worktree", "add", "-q", "-b", "side", join(repo.root, "side"));
    environments = [
      { id: "env_side", path: join(repo.root, "side"), status: "ready", lifecycle: { phase: "active" } },
      { id: "env_dead", path: join(repo.root, "side"), status: "destroyed", lifecycle: { phase: "destroyed" } },
    ];
    const result = (await harness.behavior.callRpc("listWorktrees", { projectId: PROJECT_ID })) as {
      worktrees: { branch: string; environmentIds: string[]; isMain: boolean }[];
    };
    expect(result.worktrees.map((w) => [w.branch, w.isMain, w.environmentIds])).toEqual([
      ["main", true, []],
      ["side", false, ["env_side"]],
    ]);
  });

  it("spawns into an existing environment, or attaches the path through project-checkout", async () => {
    const harness = await load();
    const side = join(repo.root, "side");
    git(repo.repo, "worktree", "add", "-q", "-b", "side", side);
    const request = { prompt: "hi", providerId: "claude-code" };

    await harness.behavior.callRpc("spawnInWorktree", { projectId: PROJECT_ID, path: side, request });
    environments = [{ id: "env_side", path: side, status: "ready", lifecycle: { phase: "active" } }];
    await harness.behavior.callRpc("spawnInWorktree", { projectId: PROJECT_ID, path: side, request });

    const calls = harness.inspection.sdk.callsTo("threads.spawn").map((args) => args[0] as Record<string, unknown>);
    expect(calls[0]).toMatchObject({
      projectId: PROJECT_ID,
      prompt: "hi",
      providerId: "claude-code",
      environment: { type: "provider", environmentProviderId: "project-checkout", inputs: { path: side } },
    });
    expect(calls[1]).toMatchObject({ environment: { type: "reuse", environmentId: "env_side" } });
  });

  it("archives the worktree's threads, runs teardown, and removes it", async () => {
    const harness = await load();
    const side = join(repo.root, "side");
    git(repo.repo, "worktree", "add", "-q", "-b", "side", side);
    environments = [{ id: "env_side", path: side, status: "ready", lifecycle: { phase: "active" } }];
    await harness.behavior.callRpc("setConfig", {
      projectId: PROJECT_ID,
      config: { teardownCommand: 'echo "$BRANCH $WORKTREE_PATH" > teardown.log' },
    });

    const result = await harness.behavior.callRpc("removeWorktree", { projectId: PROJECT_ID, path: side, deleteBranch: true });
    expect(result).toMatchObject({ archivedThreadIds: ["thr_in_worktree"], deletedBranch: "side" });
    expect(readFileSync(join(repo.repo, "teardown.log"), "utf8").trim()).toBe(`side ${side}`);
    expect(existsSync(side)).toBe(false);
  });

  it("refuses to remove a dirty worktree without force, and never the main checkout", async () => {
    const harness = await load();
    const side = join(repo.root, "side");
    git(repo.repo, "worktree", "add", "-q", "-b", "side", side);
    write(join(side, "wip.txt"), "x");
    await expect(harness.behavior.callRpc("removeWorktree", { projectId: PROJECT_ID, path: side })).rejects.toThrow();
    expect(existsSync(side)).toBe(true);
    await expect(harness.behavior.callRpc("removeWorktree", { projectId: PROJECT_ID, path: repo.repo })).rejects.toThrow();
  });
});

describe("bb task cli", () => {
  it("new spawns a thread through the task-worktree provider", async () => {
    const harness = await load();
    const result = await harness.behavior.runCli(["new", "feat/b", "do", "the", "thing", "--from", "main", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ threadId: "thr_new", branch: "feat/b" });
    expect(harness.inspection.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
      projectId: PROJECT_ID,
      prompt: "do the thing",
      environment: { type: "provider", environmentProviderId: TASK_WORKTREE_PROVIDER_ID, inputs: { branch: "feat/b", from: "main" } },
    });
  });

  it("new rejects an empty prompt", async () => {
    const harness = await load();
    const result = await harness.behavior.runCli(["new", "feat/b"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Empty prompt/);
  });

  it("config sets and resets values", async () => {
    const harness = await load();
    await harness.behavior.runCli(["config", "--base", "origin/dev", "--teardown", "make down"]);
    const shown = await harness.behavior.runCli(["config", "--base", "", "--json"]);
    expect(JSON.parse(shown.stdout)).toMatchObject({ baseRef: null, teardownCommand: "make down", effectiveBaseRef: "main", tool: "git" });
  });
});

describe("workflow", () => {
  let templates: string;

  beforeEach(() => {
    templates = join(repo.root, "templates");
    write(join(templates, "wayfinder", "task.md"), "Run {{ticket_path}} at {{timestamp}}\n");
    write(join(templates, "wayfinder", "map-bookkeeping.md"), "\n");
    write(join(templates, "wayfinder", "chart.md"), "Chart {{idea}} in {{scratch_dir}}\n");
    write(join(templates, "issues", "orchestrate.md"), "Batch:\n{{issues}}\n");
  });

  function scratchIn(root: string) {
    write(join(root, ".scratch", "demo", "MAP.md"), "# Demo\n");
    write(join(root, ".scratch", "demo", "tickets", "01-a.md"), "---\ntype: task\nstatus: open\n---\n\n# Do A\n");
    write(join(root, ".scratch", "demo", "issues", "01-x.md"), "---\nstatus: needs-plan\n---\n\n# Build X\n");
    write(join(root, ".scratch", "demo", "issues", "02-y.md"), "---\nstatus: done\n---\n\n# Build Y\n");
  }

  const spawnCalls = (harness: Awaited<ReturnType<typeof load>>) =>
    harness.inspection.sdk.callsTo("threads.spawn").map((args) => args[0] as Record<string, unknown>);

  it("scans the requested worktree's .scratch only", async () => {
    const harness = await load({ templatesDir: templates });
    const side = join(repo.root, "side");
    git(repo.repo, "worktree", "add", "-q", "-b", "side", side);
    scratchIn(side);
    const main = (await harness.behavior.callRpc("scratch", { projectId: PROJECT_ID, path: repo.repo })) as ScratchIndex;
    const inSide = (await harness.behavior.callRpc("scratch", { projectId: PROJECT_ID, path: side })) as ScratchIndex;
    expect(main.efforts).toEqual([]);
    expect(inSide.efforts.map((effort) => effort.slug)).toEqual(["demo"]);
    await expect(harness.behavior.callRpc("scratch", { projectId: PROJECT_ID, path: repo.root })).rejects.toThrow(/not a worktree/);
  });

  it("runs a ticket in its worktree with the composed prompt, title, metadata, and the agent choice", async () => {
    const harness = await load({ templatesDir: templates });
    scratchIn(repo.repo);
    const request = { providerId: "pi", model: "m", prompt: "ignored", environment: { type: "host" } };
    await harness.behavior.callRpc("runTicket", { projectId: PROJECT_ID, path: repo.repo, ref: "demo/1", request });
    const [call] = spawnCalls(harness);
    expect(call).toMatchObject({
      projectId: PROJECT_ID,
      providerId: "pi",
      model: "m",
      title: "demo/01: Do A",
      pluginMetadata: { kind: "ticket", effort: "demo", ref: "demo/01", path: repo.repo },
      environment: { type: "provider", environmentProviderId: "project-checkout", inputs: { path: repo.repo } },
    });
    expect(call?.prompt).toMatch(new RegExp(`^Run ${join(repo.repo, ".scratch/demo/tickets/01-a.md")} at \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\dZ\\n$`));
  });

  it("orchestrates the selected open issues and refuses done ones", async () => {
    const harness = await load({ templatesDir: templates });
    scratchIn(repo.repo);
    await harness.behavior.callRpc("orchestrate", { projectId: PROJECT_ID, path: repo.repo, effort: "demo", issues: ["01"] });
    expect(spawnCalls(harness)[0]).toMatchObject({
      prompt: `Batch:\n- 01 — Build X — status: needs-plan — \`${join(repo.repo, ".scratch/demo/issues/01-x.md")}\`\n`,
      title: "demo/01: Build X",
      pluginMetadata: { kind: "orchestrate", effort: "demo", ref: "demo/01" },
    });
    await expect(
      harness.behavior.callRpc("orchestrate", { projectId: PROJECT_ID, path: repo.repo, effort: "demo", issues: ["02"] }),
    ).rejects.toThrow(/done/);
  });

  it("CLI defaults --path to the calling thread's worktree", async () => {
    const harness = await load({ templatesDir: templates });
    const side = join(repo.root, "side");
    git(repo.repo, "worktree", "add", "-q", "-b", "side", side);
    environments = [{ id: "env_side", path: side, status: "ready", lifecycle: { phase: "active" } }];
    scratchIn(side);

    const listed = await harness.behavior.runCli(["scratch"], { threadId: "thr_caller" });
    expect(listed.stdout).toContain("▸ demo/01  [task] Do A");
    expect(listed.stdout).toContain("issue demo/01  needs-plan  Build X");

    const charted = await harness.behavior.runCli(["chart", "cost", "tracking", "--json"], { threadId: "thr_caller" });
    expect(charted.exitCode).toBe(0);
    expect(spawnCalls(harness)[0]).toMatchObject({
      prompt: `Chart cost tracking in ${join(side, ".scratch")}\n`,
      title: "Chart: cost tracking",
      environment: { type: "reuse", environmentId: "env_side" },
    });

    const fromMain = await harness.behavior.runCli(["scratch", "--json"]);
    expect(JSON.parse(fromMain.stdout)).toMatchObject({ root: repo.repo, efforts: [] });
  });

  it("CLI run reports a blocked ticket as a failure", async () => {
    const harness = await load({ templatesDir: templates });
    scratchIn(repo.repo);
    write(join(repo.repo, ".scratch", "demo", "tickets", "02-b.md"), "---\ntype: task\nstatus: open\nblocked-by: [01]\n---\n\n# Do B\n");
    const result = await harness.behavior.runCli(["run", "demo/02"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/blocked by 01/);
  });
});
