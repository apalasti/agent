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
};

async function makeHost() {
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
      },
    },
  });
  await plugin(host.bb);
  return host;
}

describe("bb workflow CLI", () => {
  it("lists only the frontier, with blocked count and claims", async () => {
    const { harness } = await makeHost();
    const result = await harness.behavior.runCli(["tickets"]);
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
      workspace: { type: "unmanaged", path: "/repo" },
    });
    expect(args.prompt).toContain("/repo/.scratch/dark-mode/tickets/02-pick-palette.md");
    expect(args.prompt).toContain("/repo/.scratch/dark-mode/MAP.md");
    expect(args.pluginMetadata).toMatchObject({
      kind: "ticket",
      effort: "dark-mode",
      ticket: "02-pick-palette",
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

  it("answers scan over RPC for the frontend", async () => {
    const { harness } = await makeHost();
    const result = await harness.behavior.callRpc("scan", { projectId: "proj_1" });
    expect(result.index.efforts[0].tickets).toHaveLength(3);
    expect(result.index.blockedTicketCount).toBe(1);
  });
});
