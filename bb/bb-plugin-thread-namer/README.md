# bb-plugin-thread-namer

A bb [AI service](https://getbb.app) that answers bb's own thread-title and commit-message prompts
with Claude Code — `haiku` by default — billed to your Claude Code login, with no API key.

bb decides when a thread needs a title, writes the prompt, cleans the reply and sets the title (and
the branch name that follows it). This plugin only supplies the model call: one tool-less
`claude -p --model <model>` run from a temp directory with no settings, MCP servers or slash commands,
so a project's `CLAUDE.md` and hooks stay out of it.

This replaced an earlier version that ran pi's `session-name` pipeline itself (issue-heading titles,
thin-message widening, retries); bb now owns titling and the plugin is just the model.

## Setup

```bash
bb settings ai-services set thread-title claude-code
bb settings ai-services set commit-message claude-code   # optional
bb settings ai-services test thread-title
```

Or Settings → AI services. Plugin settings (Settings → Installed plugins → Thread Namer, or
`bb plugin config thread-namer set <key> <value>`):

- `model` — any `claude --model` value: `haiku` (default), `sonnet`, a full model id.
- `claudePath` — default `claude`, looked up on PATH and in `~/.local/bin`, `~/.claude/local` and
  Homebrew, because the bb server does not inherit your shell's PATH.

bb aborts each call after 5 seconds. `haiku` answers in about 1s because the run skips Claude Code's
telemetry and update checks; a slower model may time out.

## Development

```bash
npm install && npm test && npm run typecheck
bb plugin build
```
