# bb-plugin-worktrees — design

Brings the `task.sh` / `delete-worktree.sh` workflow from irrops-ml into bb, and makes
**worktrees a first-class level inside each project** in the sidebar.

Plugin id: `worktrees`. Display name: "Worktrees". Icon: `FolderGit` (was `FolderGit2`, which is not a bb icon name and drew the Zap fallback).

## User-facing surfaces

1. **Sidebar thread list "Worktrees"** (`app.slots.experimental_threadList`).
   Pinned threads first, then `Project → Worktree → Thread (→ child threads)`.
   Every git worktree of the project's repo is known (from `git worktree list`), including
   ones created outside bb (gtr, the terminal). The main checkout is listed first, then every
   worktree with live threads, sorted by most recent thread activity, then by branch name.
   The remaining thread-less worktrees fold into one trailing "N idle worktrees" row,
   collapsed by default, that expands in place (was: every worktree listed as its own row,
   which buried other projects under idle rows). Threads whose environment path matches no git worktree get their
   own group keyed by path; threads without an environment go in a trailing "Other" group.
   - Project row: name, collapse chevron, `+` → **New task** dialog.
   - Worktree row: branch (or dir name plus a muted "· detached" when detached), dirty dot
     and ahead/behind count sharing one tooltip ("3 uncommitted files · 2 ahead of origin/x"),
     thread count when collapsed; a muted `ListTodo` badge with the count of frontier tickets +
     open issues + hand-off-ready maps in its `.scratch` (tooltip "3 ready tickets · 2 open
     issues — open Workflow"; click opens `WorkflowDialog`; there is no `Map` host icon);
     hover `+` → new thread *in this worktree*; `⋯` menu:
     New thread here, Workflow… (opens `WorkflowDialog`), Copy path, Copy branch name,
     Remove worktree… (not for the main checkout).
   - Thread row: bb's own row semantics (status indicator glyph, unread, title, pin/archive
     actions, keyboard DOM contract, split drag). A row status with tone `running` (e.g. the
     subagents plugin's "2 subagents running") also renders as a muted second line with a
     spinner under the title, so it shows even while bb's busy spinner owns the glyph slot
     (was: the status only replaced the glyph, and lost to the spinner exactly while an
     orchestrator waited on its subagents). Clicking the line opens the thread. Collapsed
     worktree and project rows add a green spinner for running statuses inside them, and the
     worktree row's tooltip lists their labels.
2. **New task dialog** — the `task.sh` port. Fields: Branch (required), Base ref (defaults
   to the project's configured base, e.g. `wizz/main`), plus an embedded
   `experimental_NewThreadComposer` so the prompt, provider, model and permission pickers
   are bb's own. Submit → thread spawns in a fresh worktree through the `task-worktree`
   environment provider, the dialog closes and the app navigates to the thread
   (`useBbNavigate().toThread`; was `experimental_useSidebarThreadActions().open`, which left
   the app where it was). The composer's `onSubmit` carries no key modifiers, so there is no
   ⌘-submit-to-stay here, unlike the Workflow dialog. The same applies to the
   new-thread-in-worktree dialog.
   **Composer seed:** when the project has no remembered execution choice, both composer
   dialogs seed `defaultProviderId/defaultModel/defaultReasoningLevel` from `agentDefaults`
   (which skips providers with no models), so the picker never opens on an uninstalled
   provider; a remembered choice is left to the composer. The composer mounts only after
   `agentDefaults` answers, because a `default*` prop that changes after mount re-seeds every
   selection.
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
   bb task scratch | run <effort>/<NN> | orchestrate <effort> [NN ...] | chart "<idea>" | handoff <effort>  [--path]
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
  src/group.ts              pure: groupSidebar(threads, projects, worktreesByProject) → SidebarTree
                            { pinned, projects: ProjectNode[], personal }, plus rollupIndicator;
                            ProjectNode splits worktrees (shown) from idleWorktrees (folded)
                            (was groupSidebar(threads, worktreesByProject, prefs) → ProjectNode[];
                            collapse prefs live in the UI, pinned/personal needed their own groups)
  src/taskRequest.ts        pure: taskSpawnRequest(request, inputs) — composer request → task-worktree spawn;
                            composerSeed(agentDefaults) → NewThreadComposer default* props ({} for a remembered choice)
  src/ui/WorktreeList.tsx   the thread-list component; owns dialog state
  src/ui/rows.tsx           GroupHeader, ProjectRow, WorktreeRow, ThreadRow (+ hover/⋯/context menus)
  src/ui/data.ts            listWorktrees per expanded project; PathStore<T> — lazy per-path cache for on-screen
                            rows, used for worktreeStatus and scratchSummary (was WorktreeStatusStore);
                            useAgentDefaults; collapse state
  src/ui/glyphs.tsx         status glyphs mirroring bb's indicator mapping
  src/ui/fields.tsx         branch + base fields, debounced validateBranch, branch suggestions
  src/ui/taskDraft.ts       lets the composer's task-worktree chip mirror an open NewTaskDialog
  src/ui/NewTaskDialog.tsx  branch + base + NewThreadComposer
  src/ui/NewThreadInWorktreeDialog.tsx  composer → RPC spawnInWorktree, for worktrees no live thread runs in;
                            a callout names the worktree because the composer's environment chips can't
                            (a `project-checkout` defaultEnvironment seed still shows the main checkout)
  src/ui/TaskWorktreeInputs.tsx  experimental_environmentProviderInputs chip for task-worktree
  src/ui/RemoveWorktreeDialog.tsx
  src/ui/WorkflowDialog.tsx  .scratch efforts of one worktree: Run / Orchestrate / Chart / Hand off
  src/scratch.ts            pure .scratch scanner + pi prompt composition (see `.scratch/` workflow)
  src/ui/ProjectSettings.tsx  settingsSection (all projects) + per-project dialog from the project ⋯ menu
  skills/worktrees/SKILL.md the `bb task` CLI for agents
  test/*.test.ts(x)         git, overlay, group, scratch, taskRequest, server (fake host), list, inputs,
                            workflow (app harness)
```

## Traces

**A worktree reaches the sidebar.** `git worktree list --porcelain` in the source checkout
(`src/git.ts listWorktrees`) → RPC `listWorktrees({projectId})` → `useRpc` in
`WorktreeList` per expanded project, refetched on realtime `worktrees-changed` and every
30 s → `groupSidebar` joins it with `experimental_useSidebarThreads().threads` on
`normalizePath(thread.environment.path) === worktree.path`, falling back to
`worktree.environmentIds` containing `thread.environment.id` (the browser cannot realpath;
was a `realpath` join) → `WorktreeRow`.

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

## `.scratch/` workflow (phase 2)

pi's `/wayfinder` and `/orchestrate` (`~/fun/agent/extensions/{wayfinder,issues}`) compose a
prompt and drop it into pi's editor through `ui.select`/`ui.input`/`setEditorText`, which bb's
pi bridge does not render (the command hangs). The plugin composes the same prompts from the
same template files and spawns the thread itself, in the worktree the `.scratch/` lives in.
(Replaced the deleted standalone `bb-plugin-workflow`, which bundled copies of the templates
and had its own worktree discovery.)

Surfaces: the worktree `⋯` menu → **Workflow…** (`WorkflowDialog`), and `bb task scratch | run
| orchestrate | chart | handoff` (documented in `skills/worktrees/SKILL.md`).

Rules carried over from pi unchanged: an effort is `.scratch/<slug>/` with `MAP.md` and/or
`issues/`; a ticket's `type` picks `wayfinder/<type>.md` (unknown → `grilling`); a ticket is on
the **frontier** when it is not `closed` and every `blocked-by` number is a `closed` ticket
(a missing blocker blocks); claimed frontier tickets stay runnable; **handoff** is offered when a
map has no open ticket; issues default to `needs-plan` and `done` ones are not batchable.

Files:

```
src/scratch.ts   node:fs, no bb imports
  scanScratch(root) → ScratchIndex
  findEffort(index, slug) → ScratchEffort                       throws naming known efforts
  findRunnableTicket(index, "<effort>/<NN>") → {effort, ticket}  refuses closed / blocked
  selectIssues(effort, numbers) → ScratchIssue[]                [] → every open issue
  ticketPrompt(templatesDir, effort, ticket, timestamp?) / handoffPrompt(templatesDir, effort, timestamp?)
  chartPrompt(templatesDir, root, idea) / orchestratePrompt(templatesDir, batch)
  promptTimestamp() → "YYYY-MM-DDTHH:MMZ"
src/scratch.ts   (round 3) ticketTemplate(ticket), summarizeScratch(index) → ScratchSummary,
                 mentionsSubagent(text, names), piSubagentActions(templatesDir, index, names),
                 liveWorkflowThreads([{threadId, metadata}], root) → LiveWorkflowThread[]
src/contract.ts  (appended) ScratchTicket {ref, number, slug, title, type, status, claimed,
                 blockedBy, blockers, state: frontier|blocked|done, path}, ScratchIssue,
                 ScratchEffort {slug, dir, mapPath|null, tickets, issues, handoffReady},
                 ScratchIndex {root, scratchDir, efforts}, AgentSelection, WorkflowThreadMetadata,
                 ScratchView = ScratchIndex + {liveThreads: {kind: ticket|issue, ref, threadId}[],
                 piSubagents: {orchestrate, tickets: ref[]}}, ScratchSummary {readyTickets,
                 openIssues, handoffs}, AgentDefaults = AgentSelection + {source: project|preferred|default}
                 RPC: scratch({projectId, path}) → ScratchView (was ScratchIndex; fields appended)
                      scratchSummary({projectId, path}) → ScratchSummary
                      runTicket({…target, ref}) / orchestrate({…target, effort, issues}) /
                      chart({…target, idea}) / handoff({…target, effort}) → {threadId}
                        where target = {projectId, path, request?}
                      agentDefaults({projectId, prefer?}) → AgentDefaults | null
server.ts        settings.templatesDir (string, default ~/fun/agent/extensions, read per run);
                 option piAgentsDir (default ~/.pi/agent/agents; its *.md names are the subagent types)
                 worktreeScratch, spawnWorkflow, runTicket, orchestrate, chart, handoff,
                 agentDefaults; CLI scratch/run/orchestrate/chart/handoff + cliWorktreePath
src/ui/WorkflowDialog.tsx  WorkflowDialog({projectId, worktreePath, worktreeLabel, open, onOpenChange})
test/scratch.test.ts, test/workflow.test.tsx, workflow block in test/server.test.ts
```

Template placeholders, filled exactly as the pi extensions do (`__dirname` there is
`<templatesDir>/wayfinder` or `<templatesDir>/issues`): `{{map_path}} {{effort_dir}} {{effort}}
{{ticket_path}} {{ticket_title}} {{ticket_type}} {{timestamp}} {{map_bookkeeping}}` (the trimmed
`wayfinder/map-bookkeeping.md`; ticket fields empty for handoff), chart's `{{idea}}
{{scratch_dir}}`, orchestrate's `{{issues}}` (`- NN — title — status: s — \`path\`` per line).
All paths are absolute under the worktree's realpath, which is what pi's `git rev-parse
--show-toplevel` root gives.

**A ticket becomes a thread.** Dialog Run (or `bb task run demo/03 --path …`) → RPC
`runTicket({projectId, path, ref: "demo/03", request?})` → `findProjectWorktree` rejects a path
that is not a git worktree of the project → `scanScratch(worktree.path)` →
`findRunnableTicket` → `ticketPrompt(settings.templatesDir, …)` → `spawnWorkflow` keeps only
`providerId/model/reasoningLevel/permissionMode/serviceTier/executionInputSources` from
`request`, adds `prompt`, `title: "demo/03: <ticket title>"`, `pluginMetadata: {kind: "ticket",
effort: "demo", ref: "demo/03", path}` → `spawnInWorktree` (shared with the worktree `+`
dialog: reuse a ready environment at that path, else `project-checkout` with `inputs: {path}`)
→ `{threadId}` → dialog closes and `useBbNavigate().toThread(threadId)`; with ⌘/Ctrl held it
stays open, toasts with an Open action, and rescans.

**The agent choice.** `agentDefaults({projectId, prefer: "pi"})` → the project's remembered
`projects.defaultExecutionOptions` when its provider is available (`source: "project"`) → else
the first available provider with models in the order `prefer`, `generalSettings.defaultProviderId`,
`providerOrder` → its default model + default reasoning → dialog seeds
`experimental_ProviderModelPicker` → the picked value rides as `request` on every spawn. (Was:
bb's global provider order only, which picked Claude Code for workflows whose orchestrate
template dispatches pi-only subagents.) When the picked provider is not `pi` and the dialog
offers orchestration (open issues and `piSubagents.orchestrate`) or a frontier ticket whose
template names a pi subagent, a muted line under the picker says "Orchestration uses pi
subagents; other providers can't run them." A template names a subagent when it contains a
`~/.pi/agent/agents/*.md` basename in backticks (orchestrate.md does; no wayfinder template
does today). When defaults cannot be resolved the picker is hidden and bb's own defaults
apply. The CLI never sends `request`.

**A ticket that already has a thread.** RPC `scratch` → `threads.list({projectId,
originPluginId: "worktrees", archived: false, limit: 100})` → keep threads whose
`environmentPath` is null or realpaths to the worktree, at most 40 → `getPluginMetadata` each
→ `liveWorkflowThreads` (newest first wins per ref; an orchestrate ref `e/01,02` covers issues
`e/01` and `e/02`; metadata `path` must equal the worktree root) → `liveThreads` → the dialog
shows **Open** (closes, `navigate.toThread`) instead of Run, with **Run again** in a `⋯` menu;
an issue gets a small Open button beside its status. Archiving the thread brings Run back.

**The row badge.** `WorktreeRow` on screen → `PathStore.request` once per refresh epoch (bumped
by realtime `worktrees-changed` and every 30 s) → RPC `scratchSummary({projectId, path})` →
`findProjectWorktree` + `scanScratch` + `summarizeScratch` → counts only, never the full scan.

**CLI `--path` default.** `ctx.threadId` → `threads.get` → `environmentId` → the worktree whose
`environmentIds` contain it; otherwise the main checkout. (Plugin CLIs run on the server, so
the caller's `BB_ENVIRONMENT_ID` is not visible; the thread id is.)

## Later phases

- Personal skills from `~/fun/agent/skills` for non-pi providers via `~/.bb/skills`.
