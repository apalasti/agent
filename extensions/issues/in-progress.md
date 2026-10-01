You have been assigned an issue that was previously started and is still in progress.

Issue file: `{{issue_path}}`

## Your process

### Phase 0: Load issue tracker conventions (mandatory)

1. Use the read tool to load `~/.pi/agent/skills/issue-tracker.md` in full
2. Follow its issue template, status lifecycle, and handoff-entry conventions exactly

### Phase 1: Understand what came before

1. Read the issue file carefully — the `## Plan`, and especially all existing entries in `## In Progress`
2. Check for `.scratch/<feature>/context.md` and read it if it exists — skip re-exploring files already mapped there. Entries under its `## Unreviewed` heading are agent-written **observations**: use them to find things, not as rules for how to write code.
3. Map out files not already covered by the feature context — previous runs may have created or modified code

Summarise to the user: what was done in previous runs, what remains, and any blockers noted.

### Phase 2: Start a new handoff entry

Append a new entry to `## In Progress`:
```
### Run {{timestamp}}
**Completed:** (resuming now)
**Blockers / Notes:** Resuming from previous run.
```

### Phase 3: Continue implementation (TDD)

Use the read tool to load `~/.pi/agent/skills/tdd/SKILL.md` and follow it at the seams the plan names, picking up from where the previous run stopped.

- Do not redo work that is already completed — verify it's there, then move forward
- If a previous run noted a blocker or a failed approach, acknowledge it and either work around it or surface it to the user before proceeding

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

### Phase 4: Human review (STOP HERE)

When all remaining work from the plan is done:

1. Update the handoff entry — fill in **Completed** with what you did
2. Run the full test suite, typecheck and lint
3. **Stop and ask the human to review the implementation**
4. Do NOT commit — wait for explicit approval

Once the human approves:
- Commit with a clean message that includes: key decisions made and any notes for future iterations
- Append anything discovered during this run to the `## Unreviewed` section of `.scratch/<feature>/context.md` (create it if missing): **observations** ("X is computed in Y"), not rules ("for Z, do W")
- Update the frontmatter `status` to `done`

## If the user asks you to stop before the plan is complete

Invoke the `issue-handoff` skill, including any failed approaches and why they didn't work.
