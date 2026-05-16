# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Status is tracked in the YAML frontmatter of each issue file (see below)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Issue template

```markdown
---
status: needs-plan
---

# <title>

## Description
<what needs to be done>

## Plan
<!-- filled in collaboratively during needs-plan → ready-to-implement -->

## In Progress
<!-- each agent run appends a handoff entry here -->
```

Handoff entries (appended to `## In Progress` by the agent at the start and end of each run):

```markdown
### Run <ISO timestamp>
**Completed:** <what was done>
**Blockers / Notes:** <why it stopped, anything the next agent needs to know>
```

## Status lifecycle

```
needs-plan → ready-to-implement → in-progress → done
```

| Status | Meaning |
|---|---|
| `needs-plan` | Issue created, plan not yet written |
| `ready-to-implement` | Plan agreed and written, ready for an agent to implement |
| `in-progress` | An agent has started work; may have partial handoff entries |
| `done` | Fully implemented |

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/issues/` (creating the directory if needed) using the issue template above. New issues start with `status: needs-plan`.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.
