---
name: issue-handoff
description: Write a handoff entry for an in-progress issue so a fresh-context agent can resume it. Use when an issue is mid-flight and the context window is full, or when only review remains.
---

# Issue Handoff

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

Append to the `## In Progress` section of the issue file in the handoff format from `issue-tracker.md`, with **Remaining** filled in.

If the only remaining step is the user's review, say so explicitly and note that a fresh, light-context agent should handle the review and small restructuring comments — no deep re-investigation needed.

### 3. Keep status accurate

Leave `status: in-progress`: handoff means work (or review) remains.

### 4. Confirm

Tell the user the handoff entry is written and summarize in one line what the next agent should start with.
