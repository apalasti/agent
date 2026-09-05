# Agent Config

My personal [pi](https://github.com/earendil-works/pi) coding agent configuration — skills, extensions, and workflows symlinked into `~/.pi/agent/`.

## Setup

```bash
./setup.sh
```

This symlinks `skills/`, `extensions/` and `agents/` into the global pi config directories. Idempotent — safe to re-run after adding new items. Existing files are backed up as `*.bak`.

## Structure

```
├── setup.sh                        # Symlink installer
├── skills/                         # Global skills (→ ~/.pi/agent/skills/)
├── extensions/                     # Global extensions (→ ~/.pi/agent/extensions/)
└── agents/                         # Subagent definitions (→ ~/.pi/agent/agents/)
```

## Wayfinding

For an idea too big and too foggy to plan in one session, `wayfinder` charts it as a map of
decision tickets under `.scratch/<effort>/`, worked one per session until the way is clear:

```
loose idea → wayfinder → to-prd → to-issues → /goal
```

The map is `MAP.md`; its tickets are `tickets/<NN>-<slug>.md`, typed `research` / `prototype` /
`grilling` / `task` and blocked via `blocked-by` frontmatter. They live apart from `issues/` so the
`/issue` and `/goal` pickers don't try to implement them. When the map is exhausted, `to-prd` reads
it and the closed tickets into a PRD, and the effort rejoins the issue workflow below.

Skip it when the way is already clear — go straight to `to-prd`.

## Issue Workflow

Issues live in `.scratch/<feature>/issues/<NN>-<slug>.md` with YAML frontmatter:

```
needs-plan → ready-to-implement → in-progress → done
```

| Command | What happens |
|---------|-------------|
| `/issue [extra instructions]` | Pick an open issue from the selector and prefill the editor with the generated prompt (optionally appending inline extra instructions) |
| Select a `needs-plan` issue | Collaborative planning: explore codebase, design plan + tests with human, write to file |
| Select a `ready-to-implement` issue | TDD implementation: tests first, then code, stop for human review before commit |
| Select an `in-progress` issue | Resume: read previous handoff entries, continue where last agent left off |

## Watch PR Workflow

Watch an Azure DevOps PR for build errors and unresolved comments, and auto-deploy the agent to fix them. Authenticates via the Azure CLI session (`az login`).

```
/watch-pr <pr-url> [interval-seconds]     # watch a specific PR
/watch-pr <repo-url> [interval-seconds]   # pick from the repo's active PRs
/watch-pr [interval-seconds]              # pick from the current repo's active PRs
/watch-pr status
/watch-pr stop [pr-id|all]
```

See [`extensions/watch-pr/README.md`](extensions/watch-pr/README.md) for details.

## Adding new skills/extensions/agents

1. Create the skill directory in `skills/`, extension in `extensions/`, or agent `.md` in `agents/`
2. Run `./setup.sh` to symlink
3. Run `/reload` in pi
