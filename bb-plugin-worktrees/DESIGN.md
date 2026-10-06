# bb-plugin-worktrees — design

Brings the `task.sh` / `delete-worktree.sh` workflow from irrops-ml into bb, and makes
**worktrees a first-class level inside each project** in the sidebar.

Plugin id: `worktrees`. Display name: "Worktrees". Icon: `FolderGit2`.

## User-facing surfaces

1. **Sidebar thread list "Worktrees"** (`app.slots.experimental_threadList`).
   Pinned threads first, then `Project → Worktree → Thread (→ child threads)`.
   Every git worktree of the project's repo is listed (from `git worktree list`), including
   worktrees with no threads yet and ones created outside bb (gtr, the terminal).
   The main checkout is listed first; the rest are sorted by most recent thread activity,
   then by branch name. Threads whose environment path matches no git worktree get their
   own group keyed by path; threads without an environment go in a trailing "Other" group.
   - Project row: name, collapse chevron, `+` → **New task** dialog.
   - Worktree row: branch (or dir name when detached), dirty dot, ahead/behind count,
     thread count when collapsed; hover `+` → new thread *in this worktree*; `⋯` menu:
     New thread here, Copy path, Remove worktree… (not for the main checkout).
   - Thread row: bb's own row semantics (status indicator glyph, unread, title, pin/archive
     actions, keyboard DOM contract, split drag).
2. **New task dialog** — the `task.sh` port. Fields: Branch (required), Base ref (defaults
   to the project's configured base, e.g. `wizz/main`), plus an embedded
   `experimental_NewThreadComposer` so the prompt, provider, model and permission pickers
   are bb's own. Submit → thread spawns in a fresh worktree through the `task-worktree`
   environment provider.
3. **Environment provider "Task worktree"** (`task-worktree`) — the same thing available
   from bb's ordinary new-thread composer environment picker, with a compact inputs chip
   (branch + base ref).
4. **Remove worktree dialog** — the `delete-worktree.sh` port: lists the threads that
   will be archived, warns on uncommitted changes, optional "delete branch", runs the
   project's teardown command, then `git gtr rm` / `git worktree remove`.
5. **CLI `bb task`** (agents use it too; documented in `skills/worktrees/SKILL.md`):
   ```
   bb task new <branch> [prompt] [--from <ref>] [--project <id|name>] [--title <t>]
               [--prompt-file <path> | --prompt-stdin]
   bb task list [--project <id|name>]          # worktrees + their threads
   bb task rm <branch|path> [--delete-branch] [--force] [--project ...]
   bb task config [--project ...] [--base <ref>] [--overlay <dir>] [--teardown <cmd>] [--setup <cmd>] [--tool <t>]
   ```
   (Replaced `--prompt-file -`: plugin CLIs run on the server and only see stdin through
   the SDK's `--<option>-stdin` rewrite, so stdin is `--prompt-stdin`.)
6. **Per-project settings section** (`app.slots.settingsSection`): base ref, overlay dir,
   setup command, teardown command, worktree tool (auto / gtr / git).

## Per-project config (plugin storage, key `project:<projectId>`)

```ts
type ProjectConfig = {
  baseRef: string | null;          // null → origin/HEAD's target, else the current branch
  overlayDir: string | null;       // relative to the source checkout; null → ".myscripts/agents" if it exists
  setupCommand: string | null;     // run with cwd = new worktree after overlay; env SOURCE_ROOT, WORKTREE_PATH, BRANCH
  teardownCommand: string | null;  // run with cwd = source checkout before removal; same env
  tool: "auto" | "gtr" | "git";   // auto → gtr when `git gtr` is on PATH
};
```

## Worktree creation (`task-worktree` environment provider `create`)

1. Resolve config + source checkout path (`project.sourcePath` / `bb.sdk.projects.get`).
2. Branch = `inputs.branch ?? suggestedBranchName`; base = `inputs.from ?? config.baseRef ?? default`.
3. If a worktree for that branch already exists → reuse its path (idempotent for the same pathKey).
4. gtr: `git gtr new <branch> --from <base> --yes` (streams copy + postCreate hooks via
   `report.log`), then `git gtr go <branch>` for the path.
   git: `git worktree add -b <branch> <repoParent>/<repoName>-worktrees/<slug> <base>`
   (no `-b` when the branch already exists). slug = branch with `/` → `-`.
5. Overlay (the task.sh port), when the overlay dir exists:
   every `AGENTS.md` under it is copied to the same relative path in the worktree and
   marked `git update-index --skip-worktree` when tracked; every other *top-level* file is
   symlinked into the worktree root and its `/name` added to `info/exclude` of the common
   git dir.
6. `setupCommand` if set.
7. Return `{ status: "created", path, ownsPath: false, mergeBaseBranch: base,
   resource: { createdByUs, branch, path } }`. `ownsPath: false` so bb never auto-deletes
   a worktree on thread archive — removal is always explicit (dialog / `bb task rm`).
   `remove()` cleans up only a cancelled launch (`environment === null` and `createdByUs`).

## Files

```
bb-plugin-worktrees/
  package.json              manifest: id worktrees, server ./server.ts, app ./app.tsx
  server.ts                 default export plugin(bb): wires provider, RPC, CLI, realtime
  app.tsx                   definePluginApp: threadList, settingsSection, env inputs control
  src/contract.ts           rpcContract (zod) + exported types — SHARED, owned by the lead
  src/git.ts                runGit/runCommand + listWorktrees, parsePorcelain, worktreeStatus,
                            defaultBaseRef, branchSlug, createWorktree, removeWorktree, hasGtr
  src/overlay.ts            applyOverlay({ sourceRoot, worktreePath, overlayDir, log })
  src/config.ts             ProjectConfig schema, loadConfig/saveConfig over bb.storage, resolveConfig
  src/group.ts              pure: groupSidebar(threads, worktreesByProject, prefs) → ProjectNode[]
  src/ui/WorktreeList.tsx   the thread-list component
  src/ui/rows.tsx           ProjectRow, WorktreeRow, ThreadRow
  src/ui/NewTaskDialog.tsx  branch + base + NewThreadComposer
  src/ui/RemoveWorktreeDialog.tsx
  src/ui/ProjectSettings.tsx
  skills/worktrees/SKILL.md the `bb task` CLI for agents
  test/*.test.ts            git.test (temp repos), overlay.test, group.test, server.test (harness)
```

## Traces

**A worktree reaches the sidebar.** `git worktree list --porcelain` in the source checkout
(`src/git.ts listWorktrees`) → RPC `listWorktrees({projectId})` → `useRpc` in
`WorktreeList` per expanded project, refetched on realtime `worktrees-changed` and every
30 s → `groupSidebar` joins it with `experimental_useSidebarThreads().threads` on
`realpath(thread.environment.path) === worktree.path` → `WorktreeRow`.

**A task becomes a thread.** NewTaskDialog `{branch, from}` + composer `NewThreadRequest`
→ `sdk.threads.spawn({...request, environment: {type: "provider", environmentProviderId:
"task-worktree", inputs: {branch, from}}})` (was `type: "new"`; the SDK's union is
`reuse | host | project-default | provider`) → core calls provider `create` → worktree path → thread runs there → realtime
`worktrees-changed` published by `create` → sidebar refetch shows the new worktree row
with its thread.

**A thread joins an existing worktree.** Worktree row `+` → RPC `spawnInWorktree({projectId,
path, request})` → if a ready environment already has that path, `environment: {type:
"reuse", environmentId}`; else `{type: "provider", environmentProviderId:
"project-checkout", inputs: {path}, machine: {type: "existing", hostId}}` (bb's built-in
provider, which attaches without creating anything).

**Remove.** RemoveWorktreeDialog → RPC `removeWorktree({projectId, path, deleteBranch,
force})` → archive every thread whose environment path is that worktree → teardownCommand
→ `git gtr rm <branch> --yes` or `git worktree remove [--force] <path>` → optional
`git branch -D` → publish `worktrees-changed`.

## Later phases (not in v1)

- `.scratch/` workflow (wayfinder tickets, issues, `/orchestrate`) surfaced per worktree.
- Personal skills from `~/fun/agent/skills` for non-pi providers via `~/.bb/skills`.
