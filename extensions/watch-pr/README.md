# watch-pr

Watches an Azure DevOps pull request for **build failures** and **unresolved review comments**, then deploys the running pi agent to fix them.

## Usage

```
/watch-pr <pr-url> [interval-seconds]     # watch a specific PR (default 60s, min 15s)
/watch-pr <repo-url> [interval-seconds]   # list active PRs in that repo, then pick one
/watch-pr [interval-seconds]              # list active PRs for the current git repo, then pick one
/watch-pr status                          # list watched PRs
/watch-pr stop [pr-id|all]                # stop watching one or all
```

Examples:

```
/watch-pr https://dev.azure.com/Wizzair-DPOProducts/OCCworks/_git/irrops-ml/pullrequest/8588
/watch-pr https://dev.azure.com/Wizzair-DPOProducts/OCCworks/_git/irrops-ml
/watch-pr
```

With no PR URL, it resolves the repo from a repo URL argument or the current checkout's
Azure DevOps remote (the branch's upstream remote is preferred, then `origin`; https and
ssh forms supported). It then opens a **live-search picker** of the active PRs: type to
filter (matches id, title, author, or branch; space-separated terms are AND-ed), use
↑/↓ to move, Enter to select, Esc to cancel. Requires the interactive TUI; in RPC mode it
falls back to a plain selector.

## How it works

On each poll the extension queries the Azure DevOps REST API (v7.1) for:

- **Failed build policies** — via `policy/evaluations`, then pulls concrete error messages from the build `timeline`.
- **Failed PR status checks** — via the PR `statuses` endpoint.
- **Unresolved comment threads** — `active`/`pending` threads with non-system comments.

New/open items are diffed against a per-PR "seen" set, so each issue is dispatched only once. When new issues appear, it injects a fix prompt into the current session with `sendUserMessage(..., { deliverAs: "followUp" })` — the agent checks out the PR source branch, fixes the errors, addresses the comments, and pushes.

## Auth

Uses the Azure CLI session — no PAT to manage. Sign in once:

```bash
az login
```

The extension fetches an AAD access token for the Azure DevOps resource via
`az account get-access-token` (cached and refreshed automatically). Your account
must have access to the target organization/project.

If the org is backed by a **different AAD tenant** than your default `az` login,
Azure DevOps returns an HTML sign-in page instead of JSON. The extension detects
this, reads the org's tenant from the `X-VSS-ResourceTenant` header, and retries
with a token scoped to that tenant. If `az` can't issue one (you're not signed in
to that tenant), it tells you the exact command: `az login --tenant <tenant-id>`.

## Assumptions

- pi is run from a **checkout of the target repo** — the agent fixes and pushes from `ctx.cwd`. The fix prompt instructs it to check out the PR source branch first.
- Watches are session-scoped and are cleared on `session_shutdown`.
