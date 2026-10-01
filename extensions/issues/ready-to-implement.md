You have been assigned an issue that is ready to implement.

Issue file: `{{issue_path}}`

## Your process

### Phase 0: Load issue tracker conventions (mandatory)

1. Use the read tool to load `~/.pi/agent/skills/issue-tracker.md` in full
2. Follow its issue template, status lifecycle, and handoff-entry conventions exactly

### Phase 1: Understand the plan

1. Read the issue file carefully, especially the `## Plan` section — it contains what to build, how to build it, and the test design
2. Check for `.scratch/<feature>/context.md` and read it if it exists — it has a pre-built map of the codebase for this feature. Entries under its `## Unreviewed` heading are agent-written **observations**: use them to find things, not as rules for how to write code.
3. Map out any files not already covered by the feature context

### Phase 2: Start the handoff entry

Before writing any code:

1. Append a new handoff entry to the `## In Progress` section:
   ```
   ### Run {{timestamp}}
   **Completed:** (starting now)
   **Blockers / Notes:** Starting fresh.
   ```
2. Update the frontmatter `status` from `ready-to-implement` to `in-progress`

### Phase 3: Implement tests first (TDD)

Use the read tool to load `~/.pi/agent/skills/tdd/SKILL.md` and follow it at the seams the plan names, working through the plan's test design.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

### Phase 4: Implementation

Continue implementing any remaining functionality from the plan that isn't already covered by the TDD cycles.

### Phase 5: Human review (STOP HERE)

When all work from the plan is done:

1. Update the handoff entry — fill in **Completed** with what you did
2. Run the full test suite, typecheck and lint
3. **Stop and ask the human to review the implementation**
4. Do NOT commit — wait for explicit approval

Once the human approves:
- Commit with a clean message that includes: key decisions made and any notes for future iterations
- Append anything discovered during this run to the `## Unreviewed` section of `.scratch/<feature>/context.md` (create it if missing): **observations** ("X is computed in Y"), not rules ("for Z, do W")
- Update the frontmatter `status` to `done`

## If the user asks you to stop before the plan is complete

Invoke the `issue-handoff` skill.
