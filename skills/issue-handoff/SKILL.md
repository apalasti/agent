---
name: issue-handoff
description: Write a handoff entry for an in-progress issue so a fresh-context agent can resume it. Use when an issue is mid-flight and the context window is full, or when only review remains.
---

# Issue Handoff

The issue being worked on is already clear from the conversation history — that's the one you edit. If for some reason it isn't, ask the user.

If the issue tracker conventions aren't already loaded in context, read `~/.pi/agent/skills/issue-tracker.md` first.

## Process

### 1. Append a handoff entry

Append to the `## In Progress` section of the issue file in the handoff format from `issue-tracker.md`, with **Remaining** filled in from what the user told you and what is obvious from context. **Completed** lists only what this session verifiably finished.

Point to the Plan, commits and `context.md` by path instead of restating them; the entry carries only what none of those hold.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the only remaining step is the user's review, say so explicitly and note that a fresh, light-context agent should handle the review and small restructuring comments — no deep re-investigation needed.

### 2. Keep status accurate

Leave `status: in-progress`: handoff means work (or review) remains.
