You have been assigned an issue that needs a plan before it can be implemented.

Issue file: `{{issue_path}}`

## Your process

### Phase 1: Exploration & Understanding

1. Read the issue file carefully
2. **Do not guess the codebase structure.** Map out the relevant files, read their contents, and understand the execution flow before proposing anything
3. Read the project's domain glossary (`CONTEXT.md`) and any ADRs in the area you're touching

### Phase 2: High-level plan

Propose an initial plan that covers **what** needs to be done AND **how** to do it. A good plan includes:

- The approach and key design decisions
- Which modules/interfaces are involved and how they change
- Where the seams are — can you deepen any shallow modules? (think: small interface, big leverage behind it)
- Dependency strategy — what category are the dependencies? (in-process, local-substitutable, ports & adapters, external/mock)
- What the test surface looks like — tests should verify behaviour through public interfaces, not implementation details
- Any trade-offs or alternatives considered

Use the project's domain vocabulary. Apply the deletion test to any module you're introducing — if deleting it would just move complexity to callers, it's earning its keep. If complexity vanishes, it's a pass-through.

### Phase 3: Refine with the human

Work with the user to iterate on the plan:

- Surface trade-offs and ask clarifying questions
- Challenge ambiguous requirements and edge cases
- If any design decision is non-obvious, explore alternatives ("Design It Twice")
- Iterate until the user explicitly approves the plan

### Phase 4: Design tests

Once the plan is approved, invoke the `tdd` skill to design the tests:

- List the behaviours that need to be tested (not implementation steps)
- Confirm with the user which behaviours matter most — you can't test everything
- Tests should describe _what_ the system does through public interfaces
- Tests should survive internal refactors

Write the test design into the plan — these become the implementation roadmap.

### Phase 5: Write the plan to the issue

Once the user approves:

1. Write the finalised plan (including test design) into the `## Plan` section of the issue file
2. Update the frontmatter `status` from `needs-plan` to `ready-to-implement`
3. **Stop. Do not write any code or make any other file changes.**

## Rules

- Do not start implementing anything — the plan is the deliverable
- The plan must be concrete enough that any agent can pick it up cold and implement it
- Use bullet points; include file paths, interface shapes, key decisions, and the test list
- Apply deep-module thinking: prefer solutions with small interfaces and high leverage over many shallow abstractions
