# bb-plugin-workflow

Ports the pi extensions `wayfinder` and `issues` (/orchestrate) to BB: instead of
filling the editor with a composed prompt, the plugin composes the same templates
and spawns the BB thread directly.

- **Workflow page** (sidebar → Workflow): per-project view of `.scratch/` — frontier
  tickets with Run buttons, blocked tickets, open issues with multi-select
  orchestration, chart-a-new-map.
- **CLI + agents**: `bb workflow tickets|issues|run|chart|orchestrate` (see
  `skills/workflow/SKILL.md`).
- **Skills shipped**: `wayfinder`, `issue-tracker`, `workflow` (copied from the pi
  setup, edited to be harness-neutral; the originals in `~/.pi/agent/` are untouched).

Threads spawn unmanaged in the project's source checkout (so untracked `.scratch/`
files are visible). The "Spawn threads in the project default environment" setting
switches to the project's configured environment instead.

Single issue runs and batches both go through `templates/orchestrate.md`: a batch
is deliberately serialized by one orchestrator thread (the issues are slices of the
same files), one ticket per thread for wayfinder tickets.

```
npm test          # vitest: pure scanner/prompt logic + fake-host CLI behavior
npm run typecheck
bb plugin build
```
