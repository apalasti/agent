---
description: Work an issue from .scratch by path or number (plan / implement / resume by status)
argument-hint: <issue-path-or-number> [extra instructions]
---

You are picking up an issue. The user passed: `$ARGUMENTS`

## Step 1 — Resolve the issue file

The first token of `$ARGUMENTS` identifies the issue; anything after it is extra instructions for you to honor.

- If it is a path to an existing `.md` file, use it directly.
- Otherwise treat it as a number or slug and search `.scratch/**/issues/` for a match (e.g. a file named `NN-*.md` or one whose slug contains the token).
- If nothing matches, or more than one issue matches, list the candidates (feature / status / slug) and ask the user which one — do not guess.

Once resolved, read the issue file and read its frontmatter `status`. Then follow the matching flow below. If `status` is missing, treat it as `needs-plan`.

## Step 0 (all flows) — Load issue tracker conventions (mandatory)

Use the read tool to load `~/.claude/skills/issue-tracker.md` in full and follow its issue template, status lifecycle, and handoff-entry conventions exactly. (The `to-tickets`, `to-spec`, `issue-handoff`, `tdd`, and `code-review` skills are also available if relevant.)

---

## If status is `needs-plan` — collaborative planning

1. **Explore.** Read the issue carefully. Check for `.scratch/<feature>/context.md` and read it if present (pre-built codebase map). Do not guess the codebase structure — map the relevant files and execution flow first. Read the project's domain glossary (`CONTEXT.md`) and any ADRs in the area you're touching.
2. **Propose a high-level plan** covering both *what* and *how*: approach and key design decisions, modules/interfaces involved and how they change, where shallow modules could be deepened (small interface, big leverage), dependency strategy, the test surface (behaviour through public interfaces), and trade-offs/alternatives. Apply the deletion test to any new module.
3. **Refine with the human.** Surface trade-offs, challenge ambiguous requirements and edge cases, explore alternatives for non-obvious decisions ("Design It Twice"). Iterate until the user explicitly approves.
4. **Design tests** — invoke the `tdd` skill. List behaviours to test (not implementation steps), confirm with the user which matter most, keep tests behaviour-focused so they survive refactors.
5. **Write the plan to the issue.** Put the finalised plan (including test design) in the `## Plan` section, flip frontmatter `status` from `needs-plan` to `ready-to-implement`, and write/update `.scratch/<feature>/context.md` with knowledge built this session. **Then stop — write no code.**

The plan is the only deliverable. It must be concrete enough for any agent to implement cold.

---

## If status is `ready-to-implement` — TDD implementation

1. **Understand the plan.** Read the issue's `## Plan` carefully. Read `.scratch/<feature>/context.md` if present, the domain glossary (`CONTEXT.md`), and relevant ADRs. Map any files the feature context doesn't cover.
2. **Start a handoff entry** before writing code — append to `## In Progress`:
   ```
   ### Run <current ISO timestamp>
   **Completed:** (starting now)
   **Blockers / Notes:** Starting fresh.
   ```
   and flip frontmatter `status` from `ready-to-implement` to `in-progress`.
3. **Implement tests-first** (`tdd` skill — vertical slices, not horizontal): write ONE test → watch it fail (RED) → minimal code to pass (GREEN) → repeat for the next behaviour → refactor once green. One test at a time; never refactor while RED; tests verify behaviour through public interfaces.
4. **Finish remaining plan work** not covered by the TDD cycles.
5. **Human review — STOP HERE.** Fill in **Completed** on the handoff entry, run the feedback loops (tests, typecheck, lint), then stop and ask the human to review. **Do NOT commit** until they approve. Once approved: commit with a clean message (key decisions, files changed, notes for next time), update `.scratch/<feature>/context.md`, and set frontmatter `status` to `done`.

---

## If status is `in-progress` — resume

1. **Understand what came before.** Read the issue's `## Plan` and especially every existing `## In Progress` entry. Read `.scratch/<feature>/context.md` if present, the domain glossary, and relevant ADRs. Map files previous runs may have touched. Summarise to the user: what was done, what remains, any noted blockers.
2. **Start a new handoff entry** in `## In Progress`:
   ```
   ### Run <current ISO timestamp>
   **Completed:** (resuming now)
   **Blockers / Notes:** Resuming from previous run.
   ```
3. **Continue implementation** (`tdd` skill) from where the last run stopped. Don't redo completed work — verify it's there and move on. Honor blockers/failed approaches noted earlier: work around them or surface them before proceeding.
4. **Human review — STOP HERE.** Same as the `ready-to-implement` flow: update **Completed**, run feedback loops, stop for review, don't commit until approved, then commit + update context + set `status: done`.

---

## If the user asks you to stop before the plan is complete

Update **Completed** with what you actually finished, update **Blockers / Notes** with what the next agent needs (including failed approaches and why), and leave `status: in-progress`.
