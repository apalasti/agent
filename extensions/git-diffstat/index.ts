import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BranchPickerComponent } from "./branch-picker.ts";
import { buildTree, parseNumstat } from "./tree.ts";
import { DiffTreeComponent } from "./view.ts";

async function git(pi: ExtensionAPI, cwd: string, args: string[]): Promise<string> {
  const result = await pi.exec("git", args, { cwd, timeout: 30_000 });
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

async function listBranches(pi: ExtensionAPI, cwd: string, current: string): Promise<string[]> {
  const refs = async (namespace: string) =>
    (await git(pi, cwd, ["for-each-ref", "--format=%(refname:short)", namespace]))
      .split("\n")
      .filter(Boolean);
  const remotes = new Set((await git(pi, cwd, ["remote"])).split("\n").filter(Boolean));

  const local = (await refs("refs/heads")).filter((name) => name !== current);
  // origin/HEAD shortens to the bare remote name
  const remote = (await refs("refs/remotes")).filter((name) => !remotes.has(name) && !name.endsWith("/HEAD"));
  return [...local, ...remote];
}

function pickBranch(ctx: any, current: string, branches: string[]): Promise<string | undefined> {
  return ctx.ui.custom(
    (tui: any, theme: any, _kb: any, done: (branch: string | undefined) => void) =>
      new BranchPickerComponent(tui, theme, `Compare ${current} against:`, branches, done),
  );
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("diffstat", {
    description: "Browse +/- line counts per folder and file against another branch",
    handler: async (args, ctx) => {
      try {
        const cwd = (await git(pi, ctx.cwd, ["rev-parse", "--show-toplevel"])).trim();
        const current = (await git(pi, cwd, ["branch", "--show-current"])).trim() || "HEAD";

        const base = args?.trim() || (await pickBranch(ctx, current, await listBranches(pi, cwd, current)));
        if (!base) return;

        const forkPoint = (await git(pi, cwd, ["merge-base", base, "HEAD"])).trim();
        const numstat = await git(pi, cwd, ["diff", "--numstat", "-z", "--no-renames", forkPoint]);
        const changes = parseNumstat(numstat);
        if (changes.length === 0) {
          ctx.ui.notify(`No changes between ${base} and ${current}`, "info");
          return;
        }

        const root = buildTree(changes);
        await ctx.ui.custom<void>(
          (tui, theme, _kb, done) =>
            new DiffTreeComponent(tui, theme, `${base}...${current}`, root, () => done()),
        );
      } catch (error) {
        ctx.ui.notify(`diffstat: ${(error as Error).message}`, "error");
      }
    },
  });
}
