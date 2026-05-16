You have been assigned an issue that is ready to implement.

Issue file: `{{issue_path}}`

## Your process

### Phase 1: Understand the plan

1. Read the issue file carefully, especially the `## Plan` section — it contains what to build, how to build it, and the test design
2. Read the project's domain glossary (`CONTEXT.md`) and any ADRs in the area you're touching
3. Map out the relevant files and understand the current execution flow — do not guess

### Phase 2: Start the handoff entry

Before writing any code:

1. Append a new handoff entry to the `## In Progress` section:
   ```
   ### Run {{timestamp}}
   **Completed:** (starting now)
   **Remaining:** <summarise what the plan calls for>
   **Blockers / Notes:** Starting fresh.
   ```
2. Update the frontmatter `status` from `ready-to-implement` to `in-progress`

### Phase 3: Implement tests first (TDD)

Follow the `tdd` skill methodology — vertical slices, not horizontal:

1. Write ONE test that confirms ONE behaviour → verify it fails (RED)
2. Write minimal code to make it pass (GREEN)
3. Repeat for the next behaviour from the plan's test design
4. After all tests pass, refactor: extract duplication, deepen modules, apply SOLID where natural

Rules:
- One test at a time — don't write all tests first
- Only enough code to pass the current test
- Tests verify behaviour through public interfaces, not implementation details
- Tests should survive internal refactors
- Never refactor while RED — get to GREEN first

### Phase 4: Implementation

Continue implementing any remaining functionality from the plan that isn't already covered by the TDD cycles.

### Phase 5: Human review (STOP HERE)

When all work from the plan is done:

1. Update the handoff entry — fill in **Completed** with what you did, list what's **Remaining** (should be nothing if done)
2. Run any relevant feedback loops (tests, typecheck, lint)
3. **Stop and ask the human to review the implementation**
4. Do NOT commit — wait for explicit approval

Once the human approves:
- Commit with a clean message that includes: key decisions made, files changed, and any notes for future iterations
- Update the frontmatter `status` to `done`

## If the user asks you to stop before the plan is complete

- Update **Completed** with what you actually finished
- Update **Remaining** with what is left
- Update **Blockers / Notes** with context the next agent needs
- Leave the status as `in-progress`
