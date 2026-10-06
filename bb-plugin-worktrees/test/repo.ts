import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

export function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export interface TempRepo {
  root: string;
  repo: string;
  cleanup(): void;
}

export function makeRepo(files: Record<string, string> = { "README.md": "hello\n" }): TempRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wt-test-")));
  const repo = join(root, "demo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  for (const [name, content] of Object.entries(files)) write(join(repo, name), content);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  return { root, repo, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function addOrigin(repo: TempRepo): string {
  const remote = join(repo.root, "origin.git");
  git(repo.root, "init", "-q", "--bare", remote);
  git(repo.repo, "remote", "add", "origin", remote);
  git(repo.repo, "push", "-q", "-u", "origin", "main");
  git(repo.repo, "remote", "set-head", "origin", "main");
  return remote;
}
