# Ledger

**Last compared:** `d81f3a1` (upstream release v1.3). Matt's paths below are relative to `mattpocock-skills/skills/skills/`.

## Counterpart map

| Ours | Matt's |
|---|---|
| `skills/code-review/` | `engineering/code-review/` |
| `skills/codebase-design/` | `engineering/codebase-design/` |
| `skills/diagnosing-bugs/` | `engineering/diagnosing-bugs/` |
| `skills/domain-modeling/` | `engineering/domain-modeling/` |
| `skills/grill-me/` | `productivity/grilling/` (his `grill-me` is an alias for it) |
| `skills/pr/` | `engineering/pr/` |
| `skills/prototype/` | `engineering/prototype/` |
| `skills/research/` | `engineering/research/` |
| `skills/tdd/` | `engineering/tdd/` |
| `skills/to-issues/` | `engineering/to-tickets/` |
| `skills/to-prd/` | `engineering/to-spec/` |
| `skills/wait-what/` | `productivity/wait-what/` |
| `skills/wayfinder/`, `extensions/wayfinder/*.md` | `engineering/wayfinder/` |
| `skills/writing-for-agents/` | `productivity/writing-for-agents/` |
| `skills/issue-tracker.md` | `engineering/setup-matt-pocock-skills/issue-tracker-local.md`, `triage-labels.md` |
| `extensions/issues/orchestrate.md`, `agents/issue-*.md` | `engineering/implement-spec/`, `engineering/implement/` |

Ours only: `skills/review-map/`, `skills/show-me/` (HumanLayer's, MIT), `agents/{Explore,Plan,general-purpose}.md`, `templates/CODING_STANDARDS.md`, and the extensions' TypeScript (code, nothing to pair).

No counterpart for Matt's `productivity/handoff/`: implementers hand off through `## In Progress` entries, written from `issue-tracker.md`'s handoff format.

## Accepted divergences

### Platform

- **No `agents/openai.yaml`** anywhere: Codex UI metadata; pi reads only `SKILL.md` frontmatter.
- **"Invoke the `x` skill" / "read `~/.pi/agent/skills/x/SKILL.md`" instead of "call the Skill tool"**: pi has no Skill tool.
- **One model-invoked `grill-me` instead of `grilling` plus a `grill-me` alias**: pi has no Skill tool to make the alias hop, and wayfinder invokes `grill-me` by name.
- **Read `~/.pi/agent/skills/issue-tracker.md` instead of "provided to you / run `/setup-matt-pocock-skills`"** (`code-review`, `to-prd`, `to-issues`, extension prompts, `issue-*` agents): the tracker is one global local-markdown file; there is no setup skill. `code-review` drops the GitHub/GitLab reference examples for the same reason.
- **`to-prd` and `to-issues` are model-invoked**: wayfinder hands off to them. Named for PRDs and issues because "tickets" means wayfinder tickets in `issue-tracker.md`.
- **`to-prd` writes `.scratch/<feature>/PRD.md`, no triage label**: the PRD is not an issue, and there is no `ready-for-agent` status.
- **`to-issues` sizes slices to be planned in one context window**: issues start at `needs-plan`, and implementation may span several handed-off runs.
- **`issue-tracker.md`: YAML frontmatter, `needs-plan → ready-to-implement → in-progress → done`, wayfinder tickets in `tickets/` with `type`/`status`/`blocked-by`/`claimed` frontmatter**: `extensions/issues/index.ts` and `extensions/wayfinder/index.ts` parse these fields; the orchestrator routes issues by status and the wayfinder picker picks prompts by ticket type.
- **Implementation is the `/orchestrate` extension template plus `issue-*` agents, not skills**: the command builds the batch from the issue files, and pi subagent types carry each role's model and prompt.
- **`diagnosing-bugs`: the user runs the HITL script, not the agent** (rung 10, the Agent-runnable check, the script's header): pi's bash tool has no stdin, so the template's first `read` exits 1. The agent copies and edits it; the user pastes back the `--- Captured ---` block.
- **Comment rules restated in `issue-implementer` / `issue-review-fixer`**: they run with `prompt_mode: replace`, which drops `AGENTS.md` (pi-subagents README).

### Decisions

- **The glossary is `GLOSSARY.md`, written by `domain-modeling`** (adopted as-is from Matt). Every reader names it; wayfinder grilling and charting invoke `domain-modeling` beside `grill-me`. Replaced the earlier `CONTEXT.md` / "the project's domain glossary" wording, which had no writer.
- **No prototype code reaches main.** A prototype is a spec written in code: the winner is rebuilt from the written-down decision or design transcript, never ported. Lives in `prototype/{SKILL,LOGIC,UI}.md` and `issue-tracker.md` "Decisions prose cannot carry" (which `to-prd` and `to-issues` point at). Reverses Matt's "fold any validated decision into the real code" and his prototype-snippet exception; introduced after an implementer read "none of its code ships" as "none of its classes matter" (04375b2, 754d441).
- **`/goal` removed**: the user no longer uses it.
- **`/issue` removed; `/orchestrate` is the only execution entry point**, for one issue or many. Interactive planning (`needs-plan.md`), human approval before commit and the `issue-handoff` skill went with it; the implementer's process moved from the `ready-to-implement`/`in-progress` prompts into `issue-implementer.md`. Replaced the earlier `/issue` + `/orchestrate` split, judged not worth its complexity.
- **Wayfinder claiming is written, and shown rather than hidden.** Each ticket prompt sets `claimed` first; the picker marks claimed tickets and keeps them selectable, since a crashed session never releases its claim. Matt's frontier excludes claimed tickets. Replaced the unused optional `claimed` field.
- **Research tickets close with the human.** Charting fires the reading and links the findings; the ticket stays open until a session reads them with the user, so a human has read every finding a decision rests on. `research.md` never re-runs research that has findings. Matt closes research tickets AFK.
- **`AGENTS.md` Debugging points at `diagnosing-bugs` instead of stating its own rules.** The user adopted Matt's process over ours. Replaced three bullets (instrument before fixing; done when the symptom is gone in the running system; never close as unreproducible against synthetic data).
- **`diagnosing-bugs` deletes throwaway harnesses, never keeps them in a debug location**: no prototype code reaches main (above). Matt allows "moved to a clearly-marked debug location".
- **`diagnosing-bugs` records a missing seam in the commit message**: Matt's "Flag this for the next phase" pointed at Cleanup, which never acts on it.
- **`/orchestrate` runs serially, not in parallel worktrees.** The user: serial has caused no problems, and it is what lets each slice be checked green and committed alone. It does work the `## Blocked by` frontier as Matt's `implement-spec` does.

Behaviour Matt lacks, kept because it changes what the agent does:

- `grill-me`: the stated-answer-with-veto paragraph and ✅ round line; the "present the settled tree" closing gate.
- `wait-what`: "This is not approval" — a re-pitch never passes a gate the skill was waiting at.
- `tdd`: "Every test must be able to fail"; seams come from the plan or PRD and are confirmed only where neither names them; description without "refactor" (the body excludes it); positive `mocking.md`.
- `to-prd`: `from-map.md` branch, module sketch, signature-for-unsettled-interfaces, the checkpoint that runs after a map too, "seams under test" reused in the template.
- `to-issues`: PRD read, missing-seam stop, user-story coverage line, checkable acceptance criteria.
- `issue-tracker.md`: issue template and handoff format as the one shared source; `## Resolution` with assets and seam exception; supersede-not-rewrite for closed tickets.
- `orchestrate` + `issue-*` agents: planner-only `.scratch/<feature>/context.md` of findings, rewritten per issue and read by no implementer (replaced agent-written observations under an `## Unreviewed` fence that the user promoted or deleted); per-issue planner with stop bar, orchestrator-run checks with one fixer, carry-over set, leakage check, chunked review with findings as leads, sentinel replies, final report.
- `prototype`: switch back to the starting branch; design transcript; embedded/standalone naming; trimmed duplicates of the branch files.
- `wayfinder`: local-markdown map with PRD as default destination; `seam` tickets; briefing, approach and premises; one question per ticket; split-don't-resume; per-type prompt guardrails; handoff step; tasks never become issues.
- Shorter descriptions in `research` and `writing-for-agents` (the latter covers agent prompts and pointer docs, which its body names).

## Open from the last session

Deferred by the user to a later session:

- `improve-codebase-architecture`, reviewed 2026-10-01 and deferred again. Open questions: Matt's exit is grilling then `/to-spec` in the same conversation, but our `to-prd` leaves out the per-file outline AGENTS.md requires for restructures (route it through `to-prd` or `issue-tracker.md`'s "Decisions prose cannot carry"?); whether the picked candidate is rendered like a wayfinder `seam` ticket, which would move that method from `extensions/wayfinder/seam.md` into `codebase-design`; a pointer from `codebase-design`'s body, since its description claims "find deepening opportunities".
- `~/.pi/agent/skills/visual-explainer` is a dangling symlink to `../../../.agents/skills/visual-explainer`.
- Candidates: `grill-with-docs`, `retro`, `to-questionnaire`, `wizard`, `ask-matt`, `triage`, `teach`, `git-guardrails-claude-code`, `migrate-to-shoehorn`, `scaffold-exercises`, `setup-pre-commit`, `claude-handoff`, `loop-me`, `setup-ts-deep-modules`, `writing-beats`, `writing-fragments`, `writing-shape`. An earlier reviewer recommended adopting the first three and `pr` (since adopted) (`retro` user-invoked) and rejecting the rest.

## Not adopted
