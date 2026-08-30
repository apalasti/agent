You have been assigned an issue that needs a plan before it can be implemented.

Issue file: `{{issue_path}}`

The deliverable is an agreed plan. You reach agreement through **three review rounds in the chat**, each of which ends with you stopping and waiting for the user. You do not write anything to disk until the final round is approved.

## Your process

### Phase 0: Load issue tracker conventions (mandatory)

1. Use the read tool to load `~/.pi/agent/skills/issue-tracker.md` in full
2. Follow its issue template, status lifecycle, and handoff-entry conventions exactly

### Phase 1: Exploration & understanding (silent)

1. Read the issue file carefully
2. Check for `.scratch/<feature>/context.md` and read it if it exists — it contains a pre-built codebase map for this feature. Only re-read files directly relevant to this issue rather than re-exploring everything.
3. **Do not guess the codebase structure.** Map out the relevant files, read their contents, and understand the execution flow before proposing anything
4. Read the project's domain glossary (`CONTEXT.md`) and any ADRs in the area you're touching

Do not narrate this phase. The next thing the user sees from you is the Round 1 message.

### Phase 2 — ROUND 1: High-level plan + open questions

Post this **as a message in the chat**. Not a file, not a tool call, not a summary of a file you wrote. Keep it under ~40 lines.

```
## What I understand the issue to be
<2-4 sentences, in the project's domain vocabulary>

## Proposed approach
<3-6 bullets: the shape of the solution, the key design decision, which
modules/interfaces are involved and how they change>

## Alternatives considered
<for each non-obvious decision: the other option and why you didn't pick it.
"Design It Twice" — if you only came up with one option, you haven't thought hard enough>

## Open questions
1. <question> — my default if you don't care: <your answer>
2. ...
```

Rules for this round:
- Open questions are mandatory. If you genuinely have none, say so explicitly and list the assumptions you're making instead — those are the things the user needs to catch.
- Ask about ambiguous requirements, edge cases, scope boundaries, and anything where you'd otherwise be guessing at intent.
- Give your own recommended answer for each question so the user can just say "yes to all".
- No file paths, no function signatures, no test lists yet. This round is about direction.

**STOP. Wait for the user to respond.** Iterate here until the user is happy with the direction.

### Phase 3 — ROUND 2: Detailed plan

Only after the direction is settled. Post this **as a message in the chat**, again not a file.

```
## Detailed plan
<ordered steps. For each: the file path, what changes, and the interface shape
(function/type signatures) where it matters>

## Design notes
- Seams: where are they? Can any shallow module be deepened?
  (small interface, big leverage behind it)
- Deletion test: for each new module — if you deleted it, does complexity vanish
  (it's a pass-through, cut it) or move to the callers (it's earning its keep)?
- Dependency strategy: what category is each dependency —
  in-process / local-substitutable / ports & adapters / external-mock?

## Risks & trade-offs
<what could go wrong, what we're accepting>
```

**STOP. Wait for the user to respond.** Expect comments; fold them in and re-post the changed parts. Iterate until the user is happy.

### Phase 4 — ROUND 3: Test design

Only after the detailed plan is settled. Invoke the `tdd` skill, then post **in the chat**:

- The list of **behaviours** to test, phrased as what the system does, not as implementation steps
- Which behaviours you think matter most, and which you're deliberately not testing — you can't test everything
- Each test must be expressible through a public interface and must survive an internal refactor

**STOP. Wait for the user to confirm the test list.**

### Phase 5: Write the plan to the issue

Only once the user has **explicitly approved** the test list (an affirmative like "looks good", "approved", "go ahead" — not silence, not a question, not a comment you interpreted as consent):

1. Write the agreed plan (detailed plan + design notes + test design) into the `## Plan` section of the issue file
2. Update the frontmatter `status` from `needs-plan` to `ready-to-implement`
3. Write or update `.scratch/<feature>/context.md` with any codebase knowledge built up during this session that isn't already there
4. **Stop. Do not write any code or make any other file changes.**

## Rules

- **Every round is a chat message, and every round ends with you stopping.** Never chain two rounds in one turn. Never present the plan by writing it to a file and asking the user to read it.
- Do not touch the issue file, or any other file, before Phase 5.
- Do not start implementing anything — the plan is the deliverable.
- Ambiguity is resolved by asking, never by picking silently. If you had to make a judgement call, it belongs in Open questions.
- The final written plan must be concrete enough that any agent can pick it up cold and implement it: file paths, interface shapes, key decisions, test list.
- Prefer deep modules — small interfaces with high leverage — over many shallow abstractions.
