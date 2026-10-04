import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const FILES: Record<string, string> = {
  "/repo/.scratch/dark-mode/MAP.md": "# Dark mode\n",
  "/repo/.scratch/dark-mode/tickets/01-pick-store.md":
    "---\ntype: research\nstatus: closed\nblocked-by: []\n---\n\n# Pick the store\n",
  "/repo/.scratch/dark-mode/tickets/02-pick-palette.md":
    "---\ntype: seam\nstatus: open\nblocked-by: [01]\n---\n\n# Pick the palette\n",
  "/repo/.scratch/dark-mode/tickets/03-rollout.md":
    "---\ntype: task\nstatus: open\nblocked-by: [02]\nclaimed: 2026-01-01T00:00Z\n---\n\n# Rollout plan\n",
  "/repo/.scratch/dark-mode/issues/01-css-vars.md":
    "---\nstatus: ready-to-implement\n---\n\n# CSS variables\n",
  "/repo/.scratch/dark-mode/issues/02-toggle.md":
    "---\nstatus: done\n---\n\n# Toggle\n",
  "/repo-wt/feat/.scratch/feat-work/MAP.md": "# Feat work\n",
  "/repo-wt/feat/.scratch/feat-work/tickets/01-wire-mel.md":
    "---\ntype: task\nstatus: open\nblocked-by: []\n---\n\n# Wire MEL\n",
  "/repo-wt/feat/.scratch/feat-work/issues/01-add-dashboard.md":
    "---\nstatus: in-progress\n---\n\n# Add dashboard\n",
  "/repo/.git/worktrees/feat/gitdir": "/repo-wt/feat/.git\n",
  "/repo/.git/worktrees/feat/HEAD": "ref: refs/heads/feature-mel-dashboard\n",
};

interface HostOverrides {
  environments?: Record<string, unknown>[];
  listedThreads?: Record<string, unknown>[];
  threadMetadata?: Record<string, Record<string, string>>;
  threadIds?: Record<string, Record<string, unknown>>;
}

async function makeHost(overrides: HostOverrides = {}) {
  const host = createFakePluginHost({
    pluginId: "workflow",
    sdk: {
      projects: {
        list: async () => [{ id: "proj_1", name: "repo" }],
        get: async () => ({
          id: "proj_1",
          sources: [{ hostId: "host_1", path: "/repo", type: "local_path", isDefault: true }],
        }),
      },
      environments: {
        list: async () => ({ environments: overrides.environments ?? [] }),
        get: async ({ environmentId }: { environmentId: string }) => {
          const env = (overrides.environments ?? []).find(
            (e) => (e as { id?: string }).id === environmentId,
          );
          if (!env) throw new Error(`no such environment ${environmentId}`);
          return env;
        },
      },
      files: {
        listPaths: async ({ path }: { path: string }) => {
          const under = Object.keys(FILES)
            .filter((p) => p.startsWith(`${path}/`))
            .map((p) => ({ kind: "file", name: p.split("/").pop(), path: p.slice(path.length + 1) }));
          if (under.length === 0) throw new Error("no such directory");
          return { truncated: false, paths: under };
        },
        read: async ({ path }: { path: string }) => {
          const content = FILES[path];
          if (content === undefined) throw new Error("no such file");
          return { content };
        },
      },
      threads: {
        spawn: async () => ({ id: "thr_1" }),
        open: async () => ({}),
        get: async ({ threadId }: { threadId: string }) => {
          const thread = overrides.threadIds?.[threadId];
          if (!thread) throw new Error(`no such thread ${threadId}`);
          return thread;
        },
        list: async () => overrides.listedThreads ?? [],
        getPluginMetadata: async ({ threadId }: { threadId: string }) =>
          overrides.threadMetadata?.[threadId] ?? {},
      },
    },
  });
  await plugin(host.bb);
  return host;
}

describe("bb workflow CLI", () => {
  it("lists only the frontier, with blocked count and claims", async () => {
    const { harness } = await makeHost();
    const result = await harness.behavior.runCli(["tickets", "--worktree", "/repo"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("dark-mode/02  [seam] Pick the palette");
    expect(result.stdout).not.toContain("Pick the store");
    expect(result.stdout).not.toContain("Rollout plan");
    expect(result.stdout).toContain("(1 blocked, hidden)");
  });

  it("spawns a ticket thread with the composed prompt and metadata", async () => {
    const { harness } = await makeHost();
    const result = await harness.behavior.runCli(["run", "dark-mode/tickets/02"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Spawned thr_1: dark-mode/02: Pick the palette");

    const spawns = harness.inspection.sdk.callsTo("threads.spawn");
    expect(spawns).toHaveLength(1);
    const args = spawns[0][0] as Record<string, any>;
    expect(args.projectId).toBe("proj_1");
    expect(args.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", hostId: "host_1", path: "/repo" },
    });
    expect(args.prompt).toContain("/repo/.scratch/dark-mode/tickets/02-pick-palette.md");
    expect(args.prompt).toContain("/repo/.scratch/dark-mode/MAP.md");
    expect(args.pluginMetadata).toMatchObject({
      kind: "ticket",
      effort: "dark-mode",
      ticket: "02-pick-palette",
      checkout: "/repo",
    });
    expect(harness.inspection.sdk.callsTo("threads.open")).toHaveLength(1);
  });

  it("orchestrates a batch, excluding done issues with a clear error", async () => {
    const { harness } = await makeHost();
    const ok = await harness.behavior.runCli(["orchestrate", "dark-mode", "01"]);
    expect(ok.exitCode).toBe(0);
    const spawns = harness.inspection.sdk.callsTo("threads.spawn");
    expect(spawns).toHaveLength(1);
    expect((spawns[0][0] as any).prompt).toContain(
      "- 01 — CSS variables — status: ready-to-implement — `/repo/.scratch/dark-mode/issues/01-css-vars.md`",
    );

    const { harness: fresh } = await makeHost();
    const done = await fresh.behavior.runCli(["orchestrate", "dark-mode", "02"]);
    expect(done.exitCode).not.toBe(0);
    expect(`${done.stderr}${done.stdout}`).toContain("done");
  });

  it("charts a new map from an idea", async () => {
    const { harness } = await makeHost();
    const result = await harness.behavior.runCli(["chart", "offline sync"]);
    expect(result.exitCode).toBe(0);
    const args = harness.inspection.sdk.callsTo("threads.spawn")[0][0] as Record<string, any>;
    expect(args.title).toBe("Chart: offline sync");
    expect(args.prompt).toContain("offline sync");
    expect(args.prompt).toContain("/repo/.scratch");
  });

  it("discovers the git worktree and scopes scans per checkout", async () => {
    const { harness } = await makeHost();
    const all = await harness.behavior.runCli(["tickets"]);
    expect(all.exitCode).toBe(0);
    expect(all.stdout).toContain("-- /repo");
    expect(all.stdout).toContain("dark-mode/02");
    expect(all.stdout).toContain("-- feature-mel-dashboard");
    expect(all.stdout).toContain("feat-work/01  [task] Wire MEL");

    const scoped = await harness.behavior.runCli(["tickets", "--worktree", "feature-mel-dashboard"]);
    expect(scoped.exitCode).toBe(0);
    expect(scoped.stdout).toContain("feat-work/01");
    expect(scoped.stdout).not.toContain("dark-mode");
  });

  it("reuses an existing BB environment when spawning into a known worktree", async () => {
    const { harness } = await makeHost({
      environments: [
        {
          id: "env_feat",
          path: "/repo-wt/feat",
          hostId: "host_1",
          branchName: "feature-mel-dashboard",
          isWorktree: true,
        },
      ],
    });
    const result = await harness.behavior.runCli([
      "run",
      "feat-work/issues/01",
      "--worktree",
      "feature-mel-dashboard",
    ]);
    expect(result.exitCode).toBe(0);
    const args = harness.inspection.sdk.callsTo("threads.spawn")[0][0] as Record<string, any>;
    expect(args.environment).toEqual({ type: "reuse", environmentId: "env_feat" });
    expect(args.prompt).toContain("/repo-wt/feat/.scratch/feat-work/issues/01-add-dashboard.md");
    expect(args.pluginMetadata).toMatchObject({ checkout: "/repo-wt/feat", kind: "orchestrate" });
  });

  it("answers scan over RPC as one section per worktree", async () => {
    const { harness } = await makeHost();
    const result = (await harness.behavior.callRpc("scan", { projectId: "proj_1" })) as any;
    expect(result.sections).toHaveLength(2);
    const primary = result.sections[0];
    expect(primary.worktree).toMatchObject({ path: "/repo", isPrimary: true });
    expect(primary.index.efforts[0].tickets).toHaveLength(3);
    const wt = result.sections[1];
    expect(wt.worktree).toMatchObject({
      path: "/repo-wt/feat",
      branch: "feature-mel-dashboard",
      isWorktree: true,
      environmentId: null,
    });
    expect(wt.index.features[0].issues[0].title).toBe("Add dashboard");
  });

  it("scanThread resolves the thread's environment to its checkout section", async () => {
    const { harness } = await makeHost({
      environments: [
        {
          id: "env_feat",
          path: "/repo-wt/feat",
          hostId: "host_1",
          branchName: "feature-mel-dashboard",
          isWorktree: true,
        },
      ],
      threadIds: { thr_in_wt: { id: "thr_in_wt", projectId: "proj_1", environmentId: "env_feat" } },
    });
    const result = (await harness.behavior.callRpc("scanThread", {
      threadId: "thr_in_wt",
    })) as any;
    expect(result.projectId).toBe("proj_1");
    expect(result.section.worktree).toMatchObject({
      path: "/repo-wt/feat",
      environmentId: "env_feat",
    });
    expect(result.section.index.efforts[0].tickets[0].title).toBe("Wire MEL");
  });

  it("rowStatuses maps plugin threads to ticket and orchestration badges", async () => {
    const { harness } = await makeHost({
      listedThreads: [
        { id: "thr_ticket", projectId: "proj_1", originPluginId: "workflow" },
        { id: "thr_orch", projectId: "proj_1", originPluginId: "workflow" },
        { id: "thr_chart", projectId: "proj_1", originPluginId: "workflow" },
        { id: "thr_other", projectId: "proj_1", originPluginId: "other-plugin" },
      ],
      threadMetadata: {
        thr_ticket: { kind: "ticket", effort: "dark-mode", number: "03", checkout: "/repo" },
        thr_orch: { kind: "orchestrate", feature: "dark-mode", issues: "01,02", checkout: "/repo" },
        thr_chart: { kind: "chart", idea: "offline sync" },
      },
      environments: [],
    });
    const result = (await harness.behavior.callRpc("rowStatuses", null)) as any;
    expect(result.statuses.thr_ticket).toEqual({
      icon: "CircleDot",
      label: "dark-mode/03 — in progress",
      tone: "running",
    });
    expect(result.statuses.thr_orch).toEqual({
      icon: "ListChecks",
      label: "dark-mode — 1/2 done",
      tone: "running",
    });
    expect(result.statuses.thr_chart).toEqual({ icon: "Map", label: "Charting: offline sync" });
    expect(result.statuses.thr_other).toBeUndefined();
  });

  it("spawnHere attaches an unmanaged environment at a git-only worktree", async () => {
    const { harness } = await makeHost();
    const result = (await harness.behavior.callRpc("spawnHere", {
      projectId: "proj_1",
      prompt: "check the mel dashboard",
      target: { path: "/repo-wt/feat", hostId: "host_1", environmentId: null },
    })) as any;
    expect(result.threadId).toBe("thr_1");
    const args = harness.inspection.sdk.callsTo("threads.spawn")[0][0] as Record<string, any>;
    expect(args.prompt).toBe("check the mel dashboard");
    expect(args.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", hostId: "host_1", path: "/repo-wt/feat" },
    });
    expect(args.pluginMetadata).toMatchObject({ kind: "manual", checkout: "/repo-wt/feat" });
  });

  it("spawnHere reuses the BB environment when the worktree has one", async () => {
    const { harness } = await makeHost({
      environments: [
        {
          id: "env_feat",
          path: "/repo-wt/feat",
          hostId: "host_1",
          branchName: "feature-mel-dashboard",
          isWorktree: true,
        },
      ],
    });
    await harness.behavior.callRpc("spawnHere", {
      projectId: "proj_1",
      prompt: "hi",
      target: { path: "/repo-wt/feat", hostId: "host_1", environmentId: null },
    });
    const args = harness.inspection.sdk.callsTo("threads.spawn")[0][0] as Record<string, any>;
    expect(args.environment).toEqual({ type: "reuse", environmentId: "env_feat" });
  });

  it("rejects an unknown --worktree with candidates", async () => {
    const { harness } = await makeHost();
    const result = await harness.behavior.runCli(["tickets", "--worktree", "nope"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("feature-mel-dashboard");
  });
});
