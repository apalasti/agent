# bb-plugin-context

Shows how full a thread's context window is and what fills it: a ring in place of bb's
context ring under the prompt with a detailed hover card, a **Context** thread panel with
the breakdown and per-turn growth, and a `bb context show` command for agents. [DESIGN.md](DESIGN.md) has the data sources, calibration rules and
file outline.

- `server.ts`: the `meter` and `report` RPC methods, the `context-changed` realtime signal,
  and the `bb context show` CLI.
- `src/events.ts`: the active timeline from bb events (turns, edits, compactions, forks).
- `src/piSession.ts`, `src/claudeTranscript.ts`: what is in context, from the pi session
  file or the Claude Code transcript.
- `src/measure.ts`: per-item tokens from the provider's per-call usage (first-call input,
  input growth per step, output per reply).
- `src/compose.ts`: the report; whatever was not measured is calibrated to bb's total.
- `src/collect.ts`: per-thread cache; session files are re-read only from the appended bytes.
- `app.tsx`, `src/ui/`: the context ring with its hover card, and the Context panel.
- `skills/context/SKILL.md`: tells agents when to run `bb context show --self`.

## Develop

```sh
npm install
npx tsc --noEmit && npx vitest run
bb plugin build && bb plugin reload context
bb context show --thread <id>
```

`test/perf.test.ts` runs only when the full-size sessions in `/tmp/ctxui/fixtures/` exist.

## Limits

Per-item numbers come from the provider's per-call usage where it fits, and from chars/4
estimates scaled to bb's total elsewhere. Breakdowns exist for pi and
Claude Code threads on the server's machine; other threads get bb's total only. bb deletes
the events an edit discards, so the "N turns discarded" count is known only when the plugin
saw the thread before the edit (it is kept in plugin storage after that).
