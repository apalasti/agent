# Claude Code Config

The [Claude Code](https://claude.com/claude-code) port of the pi agent config in the
parent folder — the same skills and issue workflow, adapted to Claude Code's primitives.

## Setup

```bash
./setup.sh
```

Symlinks `skills/` into `~/.claude/skills/` and `commands/` into `~/.claude/commands/`.
Idempotent — safe to re-run after adding items. Existing files are backed up as `*.bak`.

## Structure

```
├── setup.sh        # symlink installer (→ ~/.claude/skills, ~/.claude/commands)
├── skills/         # skills (same SKILL.md format; identical to the pi ones except
│                   #   the issue-tracker.md path points at ~/.claude/skills/)
└── commands/
    └── issue.md    # the /issue slash command
```

## How this differs from the pi config

| pi | Claude Code |
|---|---|
| `extensions/` TypeScript with `ExtensionAPI` + event hooks | not available — no equivalent extension runtime |
| `/issue` extension with an interactive issue **picker** | `/issue <path-or-number>` slash command — argument-driven, no picker |
| `extensions/issues/{status}.md` prompt templates | the three flows are inlined in `commands/issue.md` |
| `agent-group`, `paste-detector` extensions | dropped (tmux/editor-specific to pi) |
| skills reference `~/.pi/agent/skills/issue-tracker.md` | rewritten to `~/.claude/skills/issue-tracker.md` |

## Issue workflow

Issues live in `.scratch/<feature>/issues/<NN>-<slug>.md` with `status` frontmatter:
`needs-plan → ready-to-implement → in-progress → done`.

Run `/issue <path-or-number> [extra instructions]`. The command resolves the issue,
reads its `status`, and runs the matching flow:

| Status | What happens |
|---|---|
| `needs-plan` | Collaborative planning: explore, design plan + tests with you, write to the file |
| `ready-to-implement` | TDD implementation: tests first, then code, stop for review before commit |
| `in-progress` | Resume: read prior handoff entries, continue where the last run left off |

## Keeping in sync with the pi config

These skills are a **copy** of the parent `skills/` (the two agents have different
install roots, so they can't share files). When you change a skill in one place,
mirror it in the other. Only `issue-tracker.md`'s path differs between them.
