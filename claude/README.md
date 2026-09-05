# Claude Code Config

[Claude Code](https://claude.com/claude-code) skills and commands: [Matt Pocock's
skills](https://github.com/mattpocock/skills) merged with this repo's own issue
workflow.

## Setup

```bash
./setup.sh
```

Symlinks `skills/` into `~/.claude/skills/` and `commands/` into `~/.claude/commands/`.
Idempotent — safe to re-run after adding items. Existing files are backed up as `*.bak`.

`setup.sh` does not prune: symlinks for skills that have been renamed or removed stay
behind until you delete them by hand.

## Structure

```
├── setup.sh              # symlink installer (→ ~/.claude/skills, ~/.claude/commands)
├── skills/
│   └── issue-tracker.md  # the tracker convention; every tracker-aware skill reads it
└── commands/
    └── issue.md          # the /issue slash command
```

## Skills

Upstream skills, taken as-is:

| Skill | |
|---|---|
| `code-review` | Two-axis review of the diff: repo standards + Fowler smells, and spec faithfulness |
| `codebase-design` | Vocabulary for deep modules: module, interface, depth, seam, adapter, leverage, locality |
| `grill-me` / `grilling` | Relentless interview over the design tree, worked in rounds |
| `improve-codebase-architecture` | Survey for deepening opportunities, presented as an HTML report |
| `prototype` | Throwaway code that answers one design question |
| `research` | Background agent, primary sources, findings written to a cited Markdown file |
| `tdd` | Red → green at pre-agreed seams |

Upstream skills carrying local changes:

| Skill | What differs |
|---|---|
| `to-spec` | Reads `~/.claude/skills/issue-tracker.md`; adds step 0b, the wayfinder `MAP.md` handoff |
| `to-tickets` | Same tracker wiring; keeps HITL/AFK slice typing and the `status:`-frontmatter issue template |
| `wayfinder` | Local-file map under `.scratch/`; adds the `## Sessions` rules and `### Reach the destination` |
| `wait-what` | Adds "this is not approval" and "come in shorter than the message that failed" |

Local only:

| Skill | |
|---|---|
| `issue-tracker.md` | Issue/ticket conventions and the status lifecycle. Not a skill, a document skills read |
| `issue-handoff` | Appends a handoff entry to an in-progress issue so a fresh agent can resume it |

Deliberately not installed: `ask-matt`, `diagnosing-bugs`, `domain-modeling`,
`grill-with-docs`, `handoff`, `implement`, `resolving-merge-conflicts`,
`setup-matt-pocock-skills`, `teach`, `to-questionnaire`, `triage`, `wizard`,
`writing-for-agents`. `implement` and `triage` overlap the issue workflow below;
`setup-matt-pocock-skills` is unnecessary because the tracker doc is global here,
not per-repo.

## How this differs from the pi config

The pi config in the parent folder is **not** kept in sync with this one; it is
frozen on the pre-merge skill set.

| pi | Claude Code |
|---|---|
| `extensions/` TypeScript with `ExtensionAPI` + event hooks | not available — no equivalent extension runtime |
| `/issue` extension with an interactive issue **picker** | `/issue <path-or-number>` slash command — argument-driven, no picker |
| `/goal` AFK execution loop | no equivalent; `/issue` is one issue per session |
| `extensions/issues/{status}.md` prompt templates | the three flows are inlined in `commands/issue.md` |
| `to-prd` / `to-issues`, PRD.md | `to-spec` / `to-tickets`, `spec.md` |
| skills reference `~/.pi/agent/skills/issue-tracker.md` | `~/.claude/skills/issue-tracker.md` |

## Workflow

```
loose idea → wayfinder → to-spec → to-tickets → /issue
```

Skip `wayfinder` when the way is already clear and go straight to `to-spec`.

Issues live in `.scratch/<feature>/issues/<NN>-<slug>.md` with `status` frontmatter:
`needs-plan → ready-to-implement → in-progress → done`.

Run `/issue <path-or-number> [extra instructions]`. The command resolves the issue,
reads its `status`, and runs the matching flow:

| Status | What happens |
|---|---|
| `needs-plan` | Collaborative planning: explore, design plan + tests with you, write to the file |
| `ready-to-implement` | TDD implementation: tests first, then code, stop for review before commit |
| `in-progress` | Resume: read prior handoff entries, continue where the last run left off |

Wayfinder decision tickets live in `.scratch/<effort>/tickets/`, deliberately apart
from `issues/` so `/issue` never tries to implement one.

## Merging upstream changes

`mattpocock-skills/` (gitignored) is a clone of the fork at
[apalasti/skills](https://github.com/apalasti/skills), with `upstream` pointing at
`mattpocock/skills`:

```bash
cd mattpocock-skills && git fetch upstream && git merge upstream/main
```

Then re-merge changed skills into `skills/` by hand. The four "carrying local
changes" skills above are the ones that need care; the rest can be copied over
(dropping each skill's `agents/openai.yaml`, which is Codex invocation policy).
