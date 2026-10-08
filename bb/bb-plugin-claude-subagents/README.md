# bb-plugin-claude-subagents

See what Claude Code subagents in a bb thread are doing, and act on them. For threads on the Claude Code provider;
`bb-plugin-subagents` covers pi.

- **Header pill**: while agents run, a spinner, "N running" and the newest agent's context fill and current tool.
  When none run, green "N done", or amber "N need a look" when one failed or handed back no report. Click to open
  the panel.
- **Panel** "Claude subagents": one row per agent, running first. Status (green = done and reported), model,
  context fill against its window, what it is doing now (amber when quiet for over a minute), changed files,
  failed calls, and `Stop…` / `Steer…` / `Follow up…`, which draft the instruction into the thread composer for
  you to send. Click a name for its brief, live steps and report.

Everything is read locally and read-only: bb thread events plus Claude Code's transcripts under
`~/.claude/projects/`. See [DESIGN.md](DESIGN.md).

## Install

```sh
cd bb/bb-plugin-claude-subagents && npm install && bb plugin build . && bb plugin install . --yes
```

## Develop

`npm run typecheck`, `npm test`.
