# Diff tree — design

A bb plugin that shows a thread's changes as a folder tree with `+added −removed`
per folder and per file, like the pi `/diffstat` extension
(`extensions/git-diffstat`), with the patch for a file one click away.

## The gap (measured in bb 0.45.0, 2026-10-07)

bb's right-panel **Diff** tab (`⌘D`) is a vertical stream of full patches, one
card per file, headed by the file's full repo path. The composer's
**Changed files** tray and the **Info** tab list the same files as flat full
paths (Info shows 5 and "Show 13 more").

- No overview. On the `rework/solution-page` worktree vs `origin/main`
  (76 files, +3133 −4256), finding `irrops/solution_decks.py` means scrolling
  past every frontend patch above it. Nothing says "most of this branch is in
  `frontend/src/components`".
- No per-folder totals; every path repeats its whole prefix
  (`frontend/src/components/solution-page/…` ×10).
- The scope dropdown offered only "All changes" in every thread we opened;
  there is no way to pick the base branch. The base matters: that worktree's
  local `main` is stale, so vs `main` it is 1,916 files and vs `origin/main` 76.
- bb's file-list API caps at **500 files** (`truncated: true`, and its
  `shortstat` then also only counts those 500). bb's panel does not say so.

What a plugin cannot do: replace or hide bb's Diff tab, its `⌘D` binding, or
the composer tray. There is no slot for any of them. `experimental_diffRenderer`
only swaps the per-file patch body. So this plugin adds a sibling tab.

## Data sources

All through `bb.sdk.environments` (works for local and remote machines, no
shelling out to git):

| Call | Used for | Measured |
|---|---|---|
| `threads.get({ threadId })` | thread → `environmentId` | — |
| `environments.status({ environmentId })` | current branch, default branch, checkout kind | — |
| `environments.diffBranches({ environmentId, query? })` | base picker; does `origin/<default>` exist | — |
| `environments.diffFiles({ environmentId, target, mergeBaseBranch? })` | the file list: path, previousPath, changeKind, additions, deletions, binary, origin (tracked/untracked), loadMode | 0.3 s (2 files), 0.7 s (500, truncated) |
| `environments.diffPatch({ environmentId, paths, target })` | one file's unified patch, on demand | 0.26 s for 3 files |

Targets: `uncommitted`, `all` (merge-base of base..working tree, includes
untracked), `branch_committed` (merge-base of base..HEAD). The `commit` target is
out of scope.

Fixtures captured from the real API live in `test/fixtures/` (see that
directory's README for what each one is).

## Surfaces

1. **Thread panel tab "Diff tree"** (`threadPanelAction`, `layout: "flush"`).
   Listed in the right panel's new-tab Actions. Contents, top to bottom:
   - Toolbar: scope picker (`Uncommitted` / `All changes vs <base>` /
     `Commits vs <base>`), base-branch picker (searchable, from
     `diffBranches`; hidden for `Uncommitted`), refresh button.
   - Summary line: `76 files  +3133 −4256`, plus the merge-base short sha.
   - Filter input: case-insensitive substring on the path; keeps matching
     files and their folders, and expands those folders.
   - Truncation banner when the API capped the list.
   - The tree. Folder rows: chevron, name with single-child chains compressed
     (`frontend/src`), `+a −r` right-aligned. File rows: change-kind letter
     (A/M/D/R, colored), name, `+a −r` (or `binary`). Renamed files show
     `← old/path` muted. Untracked files show `A` with an "untracked" title.
   - Clicking a file row toggles its patch inline under the row, rendered by
     bb's `experimental_Diff`. Hover reveals an "open file" button
     (`experimental_openFilePreview` on a workspace target); not shown for
     deleted files.
   - Expand all / collapse all.
   - Initial expansion: breadth-first until about 40 rows are visible, so a
     small diff shows fully open and a big one shows its top folders.
   - States: loading, no changes, not a git environment, unavailable (bb's
     message), thread has no environment.
2. **Palette command** "Diff tree: show this thread's changes"
   (`app.commands.register`, available only with a thread in view), default
   shortcut `⌘⇧D`; bb leaves it unbound if that collides.
3. **CLI** `bb difftree` — the pi `/diffstat` output as text, for agents and
   shells. Defaults to the calling thread. Bounded output.
4. **Skill** `skills/difftree/SKILL.md` documenting the CLI.

The scope choice is remembered per environment in plugin storage, so the tab,
every thread on that environment, and the CLI agree.

### Default scope

Stored choice for the environment if any; otherwise:
- on a branch other than the default branch → `all` vs `origin/<default>` when
  that remote branch exists, else vs `<default>`;
- on the default branch, or detached → `uncommitted`.

## Files

```
package.json            bb manifest: name "Diff tree", branding icon ./assets/difftree.svg,
                        server ./server.ts, app ./app.tsx
assets/difftree.svg     compact branding icon (currentColor)
DESIGN.md               this file
CONTRACT-CHANGES.md     additions to src/contract.ts, one line each, by whoever made them

src/contract.ts         (lead) zod schemas + rpcContract + realtime channel. Shared.
src/tree.ts             (lead) pure: buildTree, visibleRows, filterFiles,
                        initialExpanded, allDirPaths. Shared by CLI and UI.

server.ts               (backend) default export plugin(bb): rpc.register, events → realtime,
                        cli.register. Re-exports `type rpcContract`.
src/scope.ts            (backend) defaultScope(), toTarget(), scopeLabel()
src/service.ts          (backend) createDiffService(sdk: DiffSdk, store: ScopeStore): DiffService
src/cliText.ts          (backend) renderTreeText(result, opts): string
skills/difftree/SKILL.md (backend)
test/*.test.ts          (backend) tree, scope, service (fake DiffSdk over fixtures), cliText

app.tsx                 (frontend) definePluginApp: threadPanelAction "tree", commands.register
src/ui/DiffTreePanel.tsx (frontend) the tab: toolbar, summary, filter, banner, tree
src/ui/useDiffTree.ts   (frontend) data hook: rpc tree(), DIFF_CHANGED refetch, scope set
src/ui/TreeRow.tsx      (frontend) one folder or file row
src/ui/FilePatch.tsx    (frontend) lazy rpc patch() → experimental_Diff
src/ui/ScopePicker.tsx  (frontend) scope + base branch pickers
test/ui/*.test.tsx      (frontend) SDK testing harness over fixtures
```

### Signatures

```ts
// src/scope.ts
export function defaultScope(status: { currentBranch: string | null; defaultBranch: string | null; detached: boolean },
                             remoteBranches: readonly string[]): Scope;
export function toTarget(scope: Scope):
  | { target: "uncommitted" }
  | { target: "all" | "branch_committed"; mergeBaseBranch: string };
export function scopeLabel(scope: Scope): string;   // "Uncommitted", "All changes vs origin/main", "Commits vs origin/main"

// src/service.ts
export interface DiffSdk {                           // thin adapter over bb.sdk; faked in tests
  environmentIdOf(threadId: string): Promise<string | null>;
  status(environmentId: string): Promise<EnvironmentStatusResult>;
  branches(environmentId: string, query?: string): Promise<EnvironmentDiffBranchesResult>;
  files(environmentId: string, target: ReturnType<typeof toTarget>): Promise<EnvironmentDiffFilesResult>;
  patches(environmentId: string, target: ReturnType<typeof toTarget>, paths: string[]): Promise<EnvironmentDiffPatchResult>;
}
export interface ScopeStore { get(environmentId: string): Promise<Scope | null>; set(environmentId: string, scope: Scope | null): Promise<void>; }
export interface DiffService {
  tree(input: TreeInput): Promise<TreeResult>;
  patch(input: PatchInput): Promise<PatchResult>;
  branches(input: BranchesInput): Promise<BranchesResult>;
  setScope(input: SetScopeInput): Promise<TreeResult>;
}

// src/cliText.ts
export function renderTreeText(result: TreeResult, opts: { depth: number | null; maxLines: number }): string;
```

`src/tree.ts` and `src/contract.ts` are the source of truth for their own types.

### CLI

```
bb difftree [<thread-id>] [--uncommitted | --base <branch> [--committed]] [--depth <n>] [--json]
```

Defaults: thread = caller's `ctx.threadId`; scope = the environment's
remembered/default scope (passing a scope flag does not change the remembered
one). Text output is the tree with folders and files, `+a -r` right-aligned,
capped at 200 lines with a "… N more rows" line. `--json` prints `TreeResult`.

## Deviations from this design (added while building)

- Sticky open file row: the open file's row pins to the top of the tree while
  its patch scrolls beneath it, so a long patch never loses the path header
  (added in UI round 2; the design said only "clicking a file toggles its patch
  inline under the row").
- Indent guides (1px, `bg-border/60`) per depth and a 16px per-level indent,
  for hierarchy scanability the design's "indentation by depth" did not
  specify.
- Zero stat halves render dim instead of added/removed-colored: `+114 −0` no
  longer shows a red `−0` (UI round 2).
- The truncation banner uses `role="status"`.
- The CLI shows `?` for untracked files (git's letter), where the panel shows
  `A` with an "untracked" title.
- `branchesResultSchema.message` (optional) — backend addition, logged in
  CONTRACT-CHANGES.md: a failed branch listing returns empty lists plus a
  message instead of an RPC error.
- Unknown-base guard: bb's `diffFiles` returns `available` with 0 files and
  `mergeBaseRef: null` for a base that does not exist; the service reports
  `unavailable` naming the base instead of a misleading "No changes".

## Trace: one file's `+88 −18` from git to the screen

1. The user opens **Diff tree** from the right panel's new-tab Actions on
   thread `thr_x`. bb renders `DiffTreePanel` with `{ threadId: "thr_x" }`.
2. `useDiffTree("thr_x")` calls `rpc.call("tree", { threadId: "thr_x", scope: null })`.
3. `server.ts` → `service.tree`: `sdk.environmentIdOf("thr_x")` → `threads.get`
   → `env_nu8k8jjdu3`. `store.get(env)` → null, so `sdk.status(env)` +
   `sdk.branches(env, "<default>")` → `defaultScope` →
   `{ kind: "all", base: "origin/main" }`.
4. `sdk.files(env, toTarget(scope))` → `environments.diffFiles({ environmentId,
   target: "all", mergeBaseBranch: "origin/main" })` → bb's host daemon runs
   git and returns `{ path: "frontend/src/components/solution-page/useWhatIfComparison.ts",
   changeKind: "modified", additions: 88, deletions: 18, … }`.
5. The service maps each API file to a contract `ChangedFile` and returns
   `TreeResult { outcome: "available", environmentId, scope, files, truncated, totals, … }`.
6. The hook stores it; `DiffTreePanel` runs `buildTree(filterFiles(files, query))`
   (src/tree.ts), which adds 88/18 to `frontend/src/components/solution-page`, and to
   every ancestor, compresses `frontend/src` into one row, and sorts.
7. `initialExpanded(root, 40)` picks open folders; `visibleRows(root, expanded)`
   yields rows; `TreeRow` renders `M useWhatIfComparison.ts  +88 −18`.
8. Click → `FilePatch` calls `rpc.call("patch", { threadId, scope, path })` →
   `environments.diffPatch` → `<Diff patch=… path=… />`.
9. While the agent works, core fires `experimental_thread.events` (≤1/s). The
   server throttles to one `DIFF_CHANGED { environmentId }` per environment per
   4 s, plus one on `thread.idle`. The hook refetches when the environment
   matches and keeps the current tree on screen until the new one arrives.
   Expanded folders, the open patch, and the filter survive a refetch (keyed by
   path); an open patch refetches when that file's counts change.
