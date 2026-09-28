---
name: to-issues
description: Break a plan, spec, or PRD into independently-grabbable issues on the project issue tracker using tracer-bullet vertical slices. Use when the user wants a plan, spec, or PRD broken down into implementable issues.
---

# To Issues

Break a plan into independently-grabbable issues using vertical slices (tracer bullets).

## Process

### 0. Load issue tracker conventions (mandatory)

Read `~/.pi/agent/skills/issue-tracker.md` in full at the start of every run.

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes an issue reference (issue number, URL, or path) as an argument, fetch it from the issue tracker and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Issue titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

If you cannot draw a vertical slice because the structure it would cut through does not exist yet — the tables aren't settled, the wire contract isn't settled — that is a **missing seam decision, not a slicing problem**. Do not invent the shape here: every slice would pin itself to it, unreviewed, and it is expensive to reverse by the time anyone notices. Name what is undecided and stop; it needs a `seam` ticket before the breakdown can be drawn.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Publish the issues to the issue tracker

For each approved slice, publish a new issue using the issue tracker's template, with `status: needs-plan` unless instructed otherwise. Publish in dependency order (blockers first) so **Blocked by** can reference real issues.

- **Description**: the slice's end-to-end behaviour, not layer-by-layer implementation. Leave out file paths and code, except for the decisions the issue tracker's **Decisions prose cannot carry** lists; a design transcript covering a surface this slice builds is always linked.
- **Acceptance criteria**: each one checkable on the finished slice.

Leave any parent issue open and unmodified.
