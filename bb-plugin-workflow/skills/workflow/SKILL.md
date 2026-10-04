---
name: workflow
description: Run wayfinder tickets and issue batches from a repo's .scratch/ as BB threads with the bb workflow CLI.
---

# Workflow (BB plugin)

The `bb workflow` command surfaces a project's wayfinder tickets (`.scratch/<effort>/tickets/`) and implementation issues (`.scratch/<feature>/issues/`) and spawns BB threads for them, prompts composed from the plugin's templates. Prefer it over hand-rolling prompts from these files.

Refs are `<slug>/<NN>`; when a slug holds a ticket and an issue with the same number, qualify as `<slug>/tickets/<NN>` or `<slug>/issues/<NN>`.

```
bb workflow tickets [--project <name>]            # frontier tickets (open, unblocked)
bb workflow issues [--project <name>]             # open issues
bb workflow run dark-mode/03                      # spawn a thread for one ticket
bb workflow run dark-mode/issues/01               # a single issue, as a one-item batch
bb workflow run dark-mode/handoff                 # frontier empty: hand the map off to to-prd
bb workflow chart "offline sync"                  # chart a new map from an idea
bb workflow orchestrate dark-mode "01 03 04"     # one orchestrator thread for the batch
```

`--project` (id or name) defaults to the current thread's project. Every command accepts `--json`.

Spawned threads carry their ticket/issue in thread plugin metadata (kind, effort, ticket slug or issue numbers), and open in any connected BB app.

- A ticket's thread gets the template for its type (`research`, `prototype`, `seam`, `grilling`, `task`) — one ticket per thread, never two.
- `orchestrate` sends the batch to one thread with the orchestrator prompt; the issues form a task graph through their `## Blocked by` sections, and the batch serializes on purpose.
- Tickets marked `claimed` in frontmatter are listed anyway (a dead session never releases its claim); taking one over is the user's call.
