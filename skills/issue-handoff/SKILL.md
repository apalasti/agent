---
name: issue-handoff
description: Write a handoff entry for an in-progress issue so a fresh-context agent can resume it. Use when an issue is being worked on but the current agent's context window is full and you want to hand off remaining work (or just a review) to a new agent.
---

# Issue Handoff

The current agent's context is full. Capture the remaining work in the issue file so a fresh agent can pick it up cleanly.

The issue being worked on is already clear from the conversation history — that's the one you edit. If for some reason it isn't, ask the user.

If the issue tracker conventions aren't already loaded in context, read `~/.pi/agent/skills/issue-tracker.md` first.

## Process

### 1. Take stock

From the conversation, determine:

- **What was actually completed** this session (be concrete, no guessing)
- **What is left to do** — use what the user told you, plus anything obvious from context
- **Anything the next agent must know** — decisions made, dead ends, files touched, gotchas

Keep it factual. Do not invent progress that didn't happen.

### 2. Append a handoff entry

Append to the `## In Progress` section of the issue file using the handoff format from `issue-tracker.md`:

```markdown
### Run <ISO timestamp>
**Completed:** <what was done this session>
**Remaining:** <what is left, as a short checklist>
**Blockers / Notes:** <decisions, gotchas, files touched, why it stopped>
```

If the only remaining step is the user's review, say so explicitly and note that a fresh, light-context agent should handle the review and small restructuring comments — no deep re-investigation needed.

### 3. Keep status accurate

Leave `status: in-progress`. Do not mark the issue `done` — handoff means work (or review) remains.

### 4. Confirm

Tell the user the handoff entry is written and summarize in one line what the next agent should start with.
