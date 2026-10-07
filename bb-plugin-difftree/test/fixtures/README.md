Real `bb … --json` output captured 2026-10-07 from bb 0.45.0. Shapes match the SDK results.

- `nu.*` — env_nu8k8jjdu3, worktree `rework/solution-page` of irrops-ml (existing-checkout).
  - `nu.all-origin-main.json` — diffFiles target `all` vs `origin/main`: 76 files, one untracked (GLOSSARY.md), one `too_large`-ish `on_demand` file, adds/deletes/modifies. The realistic case.
  - `nu.branch-origin-main.json` — target `branch_committed` vs `origin/main`: 75 files.
  - `nu.uncommitted.json` — target `uncommitted`: 1 untracked file, with `initialPatches`.
  - `nu.all-main-truncated.json` — target `all` vs stale local `main`: capped at 500 files, `truncated: true`, includes renames and `on_demand`.
  - `nu.patch.json` — diffPatch for 3 paths under target `all` vs `origin/main`.
  - `nu.branches-main.json` — diffBranches with query `main` (has `origin/main`).
  - `env_nu8k8jjdu3.status.json` — environments.status: branch `rework/solution-page`, default `main`.
- `agent.*` / `env_t3w24mmpux.*` — this repo's project checkout on `main` (the default branch).
  - `agent.all.json` — target `all` vs `main`: 2 untracked files.
  - `agent.branches.json` — diffBranches, remote `origin/main` only.
