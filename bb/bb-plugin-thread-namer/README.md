# bb-plugin-thread-namer

A bb [AI service](https://getbb.app) that answers bb's own thread-title and commit-message prompts
with pi — `claude-bridge/claude-haiku-5-5` by default — using whatever providers your pi setup has.

bb decides when a thread needs a title, writes the prompt, cleans the reply and sets the title (and
the branch name that follows it). This plugin only supplies the model call: one tool-less
`pi -p --model <model>` run from a temp directory with no session, skills, context files, prompt
templates, themes or MCP, so a project's `AGENTS.md` stays out of it.

This replaced a version that called the Claude Code CLI (`claude -p`), which in turn replaced one
that ran pi's `session-name` pipeline itself; bb now owns titling and the plugin is just the model.

## Setup

```bash
bb settings ai-services set thread-title pi
bb settings ai-services set commit-message pi   # optional
bb settings ai-services test thread-title
```

Or Settings → AI services. Plugin settings (Settings → Installed plugins → Thread Namer, or
`bb plugin config thread-namer set <key> <value>`):

- `model` — any `pi --model` value, `provider/model-id`; default `claude-bridge/claude-haiku-5-5`.
- `piPath` — default `pi`, looked up on PATH and in `~/.pi/agent/bin`, `~/.local/bin` and Homebrew,
  because the bb server does not inherit your shell's PATH.
- `extensions` — comma-separated extension paths. Empty (default) loads every installed pi
  extension, which the model's provider may need; listing only the provider's extension
  (`--no-extensions -e …`) starts faster.

bb aborts each call after 5 seconds. With all extensions loaded a haiku title takes about 2.5s;
with only the provider extension about 1.4s.

## Development

```bash
npm install && npm test && npm run typecheck
bb plugin build
```
