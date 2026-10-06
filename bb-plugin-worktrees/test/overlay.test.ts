import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createWorktree, spawnRunner } from "../src/git";
import { applyOverlay } from "../src/overlay";
import { git, makeRepo, write, type TempRepo } from "./repo";

let repo: TempRepo;
afterEach(() => repo?.cleanup());

it("copies AGENTS.md files, marks tracked ones skip-worktree, and links other top-level files", async () => {
  repo = makeRepo({ "AGENTS.md": "tracked\n", "src/main.txt": "x\n" });
  const overlayDir = join(repo.repo, ".myscripts", "agents");
  write(join(overlayDir, "AGENTS.md"), "personal root\n");
  write(join(overlayDir, "src", "AGENTS.md"), "personal src\n");
  write(join(overlayDir, "CODING_STANDARDS.md"), "standards\n");
  write(join(overlayDir, "nested", "IGNORED.md"), "not top-level\n");
  const { path } = await createWorktree({ runner: spawnRunner, sourceRoot: repo.repo, branch: "task", base: "main", tool: "git", log: () => {} });

  const args = { runner: spawnRunner, sourceRoot: repo.repo, worktreePath: path, overlayDir, log: () => {} };
  const result = await applyOverlay(args);
  await applyOverlay(args);

  expect(result).toEqual({
    copied: ["AGENTS.md", "src/AGENTS.md"],
    skipWorktree: ["AGENTS.md"],
    symlinked: ["CODING_STANDARDS.md"],
  });
  expect(readFileSync(join(path, "AGENTS.md"), "utf8")).toBe("personal root\n");
  expect(readFileSync(join(path, "src", "AGENTS.md"), "utf8")).toBe("personal src\n");
  expect(git(path, "ls-files", "-v", "AGENTS.md").trim()).toBe("S AGENTS.md");
  expect(git(path, "status", "--porcelain").trim()).toBe("?? src/AGENTS.md");
  expect(lstatSync(join(path, "CODING_STANDARDS.md")).isSymbolicLink()).toBe(true);
  expect(readlinkSync(join(path, "CODING_STANDARDS.md"))).toBe(join(overlayDir, "CODING_STANDARDS.md"));
  const exclude = readFileSync(join(repo.repo, ".git", "info", "exclude"), "utf8");
  expect(exclude.split("\n").filter((line) => line === "/CODING_STANDARDS.md")).toHaveLength(1);
});
