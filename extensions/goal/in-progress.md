You have been assigned an issue that was previously started and is still in progress.

Issue file: `{{issue_path}}`

## Your process

### Phase 0: Load issue tracker conventions (mandatory)

1. Use the read tool to load `~/.pi/agent/skills/issue-tracker.md` in full
2. Follow its issue template, status lifecycle, and handoff-entry conventions exactly

### Phase 1: Understand what came before

1. Read the issue file carefully — the `## Plan`, and especially all existing entries in `## In Progress`
2. Check for `.scratch/<feature>/context.md` and read it if it exists — skip re-exploring files already mapped there
3. Read the project's domain glossary (`CONTEXT.md`) and any ADRs in the area you're touching
4. Map out files not already covered by the feature context — previous runs may have created or modified code

Summarise to the user: what was done in previous runs, what remains, and any blockers noted.

### Phase 2: Start a new handoff entry

Append a new entry to `## In Progress`:
```
### Run {{timestamp}}
**Completed:** (resuming now)
**Blockers / Notes:** Resuming from previous run.
```

### Phase 3: Continue implementation (TDD)

Follow the `tdd` skill methodology — vertical slices, not horizontal:

1. Pick up from where the previous run stopped
2. Write ONE test → make it pass → repeat
3. Only enough code to pass the current test
4. After tests pass, refactor

Rules:
- Do not redo work that is already completed — verify it's there, then move forward
- If a previous run noted a blocker or a failed approach, acknowledge it and either work around it or surface it to the user before proceeding
- Tests verify behaviour through public interfaces, not implementation details
- Never refactor while RED — get to GREEN first

### Phase 4: Human review (STOP HERE)

When all remaining work from the plan is done:

1. Update the handoff entry — fill in **Completed** with what you did
2. Run any relevant feedback loops (tests, typecheck, lint)
3. **Stop and ask the human to review the implementation**
4. Do NOT commit — wait for explicit approval

Once the human approves:
- Commit with a clean message that includes: key decisions made, files changed, and any notes for future iterations
- Update `.scratch/<feature>/context.md` with anything discovered during this run that isn't already there
- Update the frontmatter `status` to `done`

## If the user asks you to stop before the plan is complete

- Update **Completed** with what you actually finished
- Update **Blockers / Notes** with context the next agent needs (include any failed approaches and why they didn't work)
- Leave the status as `in-progress`
