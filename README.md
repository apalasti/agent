# Agent Config

My personal [pi](https://github.com/earendil-works/pi) coding agent configuration — skills, extensions, and workflows symlinked into `~/.pi/agent/`.

## Setup

```bash
./setup.sh
```

This symlinks `skills/` and `extensions/` into the global pi config directories. Idempotent — safe to re-run after adding new items. Existing files are backed up as `*.bak`.

## Structure

```
├── setup.sh                        # Symlink installer
├── skills/                         # Global skills (→ ~/.pi/agent/skills/)
└── extensions/                     # Global extensions (→ ~/.pi/agent/extensions/)
```

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

## Adding new skills/extensions

1. Create the skill directory in `skills/` or extension in `extensions/`
2. Run `./setup.sh` to symlink
3. Run `/reload` in pi
