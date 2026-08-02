# Agent Config

My personal [pi](https://github.com/earendil-works/pi) coding agent configuration — skills, extensions, and workflows symlinked into `~/.pi/agent/`.

## Setup

```bash
./setup.sh
```

This symlinks `skills/` and `extensions/` into the global pi config directories, checks out the submodules under `packages/`, installs their npm dependencies, and registers them with `pi install`. Idempotent — safe to re-run after adding new items. Existing files are backed up as `*.bak`.

For a fresh clone, `git clone --recurse-submodules` is optional; `setup.sh` initializes submodules itself.

## Structure

```
├── setup.sh                        # Symlink installer
├── skills/                         # Global skills (→ ~/.pi/agent/skills/)
├── extensions/                     # Global extensions (→ ~/.pi/agent/extensions/)
└── packages/                       # Forked upstream extensions, as git submodules
```

### packages/

Forks of published pi extensions that we carry patches on top of. Each is a git
submodule pinned to a commit on our fork, so the patch travels with the repo.
They are not symlinked like `extensions/` — pi loads them from the `packages`
list in `~/.pi/agent/settings.json`, pointing at the checkout.

| Package | Fork | Upstream |
|---------|------|----------|
| `pi-claude-bridge` | [apalasti/pi-claude-bridge](https://github.com/apalasti/pi-claude-bridge) | [elidickinson/pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge) |

To rebase a fork onto upstream:

```bash
cd packages/pi-claude-bridge
git fetch upstream && git rebase upstream/main
npm ci && npm run typecheck && npm run test:unit
git push --force-with-lease origin HEAD
cd ../.. && git commit packages/pi-claude-bridge -m "Bump pi-claude-bridge"
```

If `npm:pi-claude-bridge` is still in pi's `packages` list, remove it — otherwise
the published build and the fork both register and the extension loads twice.

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

## Adding new skills/extensions

1. Create the skill directory in `skills/` or extension in `extensions/`
2. Run `./setup.sh` to symlink
3. Run `/reload` in pi
