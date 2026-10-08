# bb-plugin-pi-subagents

See what pi subagents and workflows (`@tintinweb/pi-subagents`) in a bb thread are doing, and act on them. For
threads on the pi provider.

- **Header pill**: while work runs, a spinner, "N running" (plus "· N workflow" when workflows run too, or
  "Workflow: <name>" when only a workflow runs) and the newest agent's current tool. When nothing runs, green
  "N done", or amber "N need a look" when one failed or handed back no report. Click to open the panel.
- **Panel** "Subagents": a card per workflow, then a card per agent, running first. An agent card shows its type,
  status, duration, model, tokens and tool uses; **View transcript** opens its model, prompt (copyable), a one-line
  activity summary that expands into the steps, and its report. From there `Steer…` (running) or `Follow up…`
  (finished) drafts the instruction into the thread composer for you to send. **View agents** on a workflow card
  lists its phases and the agents it started.

Everything is read locally and read-only: bb thread events, the pi session files under
`~/.bb/pi-bridge-sessions/` and `~/.pi/agent/sessions/`, and pi-subagents' task files. See
[DESIGN.md](DESIGN.md).

## Install

```sh
cd bb/bb-plugin-pi-subagents && npm install && bb plugin build . && bb plugin install . --yes
```

Replacing the old Claude Code plugin: `bb plugin uninstall claude-subagents` first.

## Develop

`npm run typecheck`, `npm test`.
