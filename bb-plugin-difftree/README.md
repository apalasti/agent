# bb-plugin-difftree

Shows a thread's git changes as a folder tree with `+added −removed` per folder and file,
against a base branch the user picks: a **Diff tree** thread panel tab, a palette command
(`⌘⇧D`), and a `bb difftree` command for agents. [DESIGN.md](DESIGN.md) has the data
sources, surfaces, default-scope rule, file outline and an end-to-end trace.

- `server.ts`: the `tree`, `patch`, `branches` and `set_scope` RPC methods, the
  `diff-changed` realtime signal (at most once per environment per 4 s while a thread
  works, and once when it goes idle), and the `bb difftree` CLI. Adapts `bb.sdk` to
  `DiffSdk` and `bb.storage.kv` to `ScopeStore`.
- `src/contract.ts`: zod schemas for the RPC methods and the realtime payload.
  `CONTRACT-CHANGES.md` logs additions.
- `src/service.ts`: thread → environment → scope (explicit, remembered, or default) →
  `environments.diffFiles`, mapped to contract outcomes. bb errors never escape as RPC errors.
- `src/scope.ts`: `defaultScope`, `toTarget` (scope → bb diff target) and `scopeLabel`.
- `src/tree.ts`: the folder tree, shared by the panel and the CLI.
- `src/cliText.ts`: the CLI's text tree.
- `app.tsx`, `src/ui/`: the panel tab and the palette command.
- `skills/difftree/SKILL.md`: tells agents how to use `bb difftree`.
- `test/fixtures/`: real bb API output; see its README.

## Develop

```sh
npm install
npx tsc --noEmit && npx vitest run
bb plugin build && bb plugin reload difftree
bb difftree <thread-id>
```

## Limits

bb lists at most 500 files per diff, and its totals then cover only those; the panel and
the CLI say so. An unknown base branch comes back from bb as an empty diff with no merge
base, which the plugin reports as unavailable. The remembered scope is per environment, so
every thread on a checkout shares it.
