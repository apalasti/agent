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

Work from whatever is already in the conversation context. If the feature has a `.scratch/<feature-slug>/PRD.md`, read it in full. If the user passes an issue reference (issue number, URL, or path) as an argument, fetch it from the issue tracker and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Issue titles and descriptions should use the vocabulary in `GLOSSARY.md` (if it exists), and respect ADRs in the area you're touching.

Look for opportunities to **prefactor**: make the change easy, then make the easy change.

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Give each one its **Blocked by**: the other issues that must complete before it can start. An issue with no blockers can start immediately.

<vertical-slice-rules>
- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is small enough for one agent to plan in a single fresh context window
- Prefactoring slices come first
</vertical-slice-rules>

If you cannot draw a vertical slice because the structure it would cut through does not exist yet — the tables aren't settled, the wire contract isn't settled — that is a **missing seam decision, not a slicing problem**. Do not invent the shape here: every slice would pin itself to it, unreviewed, and it is expensive to reverse by the time anyone notices. Name what is undecided and stop; it needs a `seam` ticket before the breakdown can be drawn.

**Wide refactors are the exception to vertical slicing.** A wide refactor is one mechanical change (rename a column, retype a shared symbol) whose blast radius fans across the codebase, so no vertical slice can land green. Sequence it as **expand–contract**:

1. **Expand**: add the new form beside the old, so nothing breaks.
2. **Migrate**: move the call sites over in batches sized by blast radius (per package, per directory), one issue per batch, each blocked by the expand. The old form still exists, so every batch leaves the suite green. A batch that cannot stay green on its own merges with its neighbour until it can. When a merged batch would no longer fit one context window, keep the batches but let them share an integration branch, all blocking a final integrate-and-verify issue; green is promised only there.
3. **Contract**: delete the old form once no caller remains, blocked by every migrate batch.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **What it delivers**: the end-to-end behaviour this slice makes work
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Below the list, name every user story that no slice covers, or say that none is left uncovered.

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Does each slice depend only on slices that genuinely gate it?
- Should any slices be merged or split further?

Iterate until the user approves the breakdown.

### 5. Publish the issues to the issue tracker

For each approved slice, publish a new issue using the issue tracker's template, with `status: needs-plan` unless instructed otherwise. Publish in dependency order (blockers first) so **Blocked by** can reference real issues.

- **Description**: opens with a link to the PRD (`../PRD.md`), or to the parent issue when the source was one, then the slice's end-to-end behaviour, not layer-by-layer implementation. Leave out file paths and code, except for the decisions the issue tracker's **Decisions prose cannot carry** lists; a design transcript covering a surface this slice builds is always linked.
- **Acceptance criteria**: each one checkable on the finished slice.

Leave any parent issue open and unmodified.
