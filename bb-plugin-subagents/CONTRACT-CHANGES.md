# Contract changes

`src/contract.ts` changes after the first agreed version. All are append-only: no field was
removed or retyped.

## Files touched and thread environment (panel round 2)

- `subagentSchema.filesTouched: { path, writes, edits }[]` — successful `write`/`edit` calls (and
  Claude-Code-style `Write`/`Edit`/`MultiEdit`/`NotebookEdit`) per file, absolute paths
  (relative tool paths resolved against the pi session cwd), in first-touch order.
- `threadSubagents` output `environment: { id, hostId, path } | null` — the thread's environment,
  so the panel can show paths relative to it and build `experimental_FileLink` targets.
- `tool` transcript entries' `summary` (and `Subagent.lastActivity`) are now shortened for display:
  a leading `cd <environment or cwd> &&` is dropped, other `cd` targets become `…/<basename>`, and
  paths under the environment are relative. `args` keeps the full text.
