# Workflow

Runs wayfinder tickets and issue batches from a project's `.scratch/` as BB
threads — the port of the pi `wayfinder` + `issues` (/orchestrate) extensions.

- Sidebar **Workflow** page: frontier tickets with Run, blocked tickets, open
  issues with multi-select orchestration, chart a new map.
- CLI: `bb workflow tickets|issues|run|chart|orchestrate` (agent-facing, see
  `skills/workflow/SKILL.md`).
- Skills shipped with the plugin: `wayfinder`, `issue-tracker`, `workflow`.
- Threads spawn unmanaged in the project's source checkout by default so
  untracked `.scratch/` files are visible; the settings toggle uses the
  project's default environment instead.

Development: `npm test`, `npm run typecheck`, `bb plugin build`,
`bb plugin dev` for the live reload loop.
