---
name: issue-tracker
description: This repo's issues, PRDs, and wayfinder maps live as markdown in .scratch/ — conventions, statuses, and wayfinding operations (tickets, blocking, frontier).
disable-model-invocation: true
---

# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are one file per issue at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined file
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

## Acceptance criteria
- [ ] <criterion>

## Blocked by
<links to blocking issues, or "None - can start immediately">

## Plan
<!-- filled in by issue-planner during needs-plan → ready-to-implement -->

## In Progress
<!-- each agent run appends a handoff entry here -->
```

Handoff entries (appended to `## In Progress` by the agent at the start and end of each run):

```markdown
### Run <ISO timestamp>
**Completed:** <what was done>
**Remaining:** <what is left, as a short checklist; omit when the run finished its work>
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

Create a new file under `.scratch/<feature-slug>/issues/` (creating the directory if needed) using the issue template above. New issues start with `status: needs-plan`, including issues described as "ready for an AFK agent": planning is their first step.

## Decisions prose cannot carry

PRDs and issues leave out file paths and code, which go stale. The exceptions are decisions prose cannot carry precisely:

- **A settled interface is carried as its shape, verbatim**: signature, type declaration, endpoint contract, table-and-column sketch. Where a `seam` ticket settled it, copy its `## Resolution`. A prose re-description is the version that gets reversed.
- **A prototype is a spec written in code, never a source of code.** It shows what to build; its code, markup and component structure are not reused, and nothing is copied out of it. What it settled is carried in words:
  - a settled **design** by its design transcript (`design/<slug>.md`, written by the `prototype` skill), linked by path and named as binding: what the user sees (placement, emphasis, copy, states), with the screenshots settling any disagreement;
  - a settled **behaviour** as the states, transitions and rules the walkthroughs proved, written into the decision it supports.

  Summarising either, or writing "per the prototype", loses exactly the details that get reinvented. A deliberate departure is written down as a departure; silence reads as an oversight and gets implemented as one.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

The `wayfinder` skill charts a large, foggy effort as a map of decision tickets. Those tickets are **decisions, not work**, so they live apart from implementation issues:

```
.scratch/<effort-slug>/
├── MAP.md          # the map — one per effort, the canonical artifact
├── tickets/
│   └── <NN>-<slug>.md
├── research/
│   └── <slug>.md   # findings from research tickets
├── design/
│   └── <slug>.md   # design transcripts from prototypes that settled a design
├── PRD.md          # the usual destination, written by to-prd once the map is done
└── issues/
    └── <NN>-<slug>.md
```

**Wayfinder tickets live in `tickets/`, never `issues/`.** The `/orchestrate` picker scans `issues/` and treats everything not `done` as implementable, so a decision ticket there gets picked up and TDD-implemented.

### The map

`MAP.md` is identified by its filename; it has no frontmatter. Its body follows the template in the `wayfinder` skill.

### Tickets

```markdown
---
type: grilling
status: open
blocked-by: [02, 05]
---

# <title>

## Question

## Assets

## Resolution
```

| Field | Values |
|---|---|
| `type` | `research`, `prototype`, `seam`, `grilling`, `task` |
| `status` | `open`, `closed` |
| `blocked-by` | ticket numbers, `[]` if none |
| `claimed` | ISO timestamp, written by the session that takes the ticket before any other work; absent until then |

Ticket numbers are their `NN` prefix, numbered from `01`, in a sequence separate from `issues/`.

### Blocking and the frontier

A ticket is **unblocked** when every number in its `blocked-by` refers to a `status: closed` ticket. The **frontier** is the open, unblocked tickets — computed by reading `tickets/` and checking each one's blockers. A claimed ticket stays on the frontier, marked as taken: a session that dies never releases its claim, so the user decides whether to take it over.

### Resolving a ticket

There are no comments, so the resolution is written into the ticket's own `## Resolution` section. Closing a ticket is three edits:

1. Write the answer into `## Resolution`
2. Set `status: closed`
3. Append one line to the map's **Decisions so far**: `- [<title>](tickets/NN-slug.md): <gist>`

Assets are linked from `## Assets`, never pasted in: research notes as paths under `research/`, prototypes as the branch name the `prototype` skill produced, design transcripts and their screenshots as paths under `design/`.

A `seam` ticket is the exception to "linked, not pasted": its resolution **is** the shape, so the signature, type declaration or table sketch is written into `## Resolution` as code, along with the rejected candidate and one line on why it lost.

### When a decision is reversed later

Decisions get reversed downstream — the code gets built, the call sites become real, and the shape turns out wrong. This is the ticket-specific case of the global rule to update the artifact that recorded a decision: a closed ticket is superseded, not rewritten. Leave its `## Resolution` text as it stands and:

1. Add one line at the top of that section: `> Superseded by <link to where the new decision lives>`
2. Record the new decision where it now stands. Before hand-off, that is a new ticket, and the map's **Decisions so far** gist points at it. After hand-off (the map carries the `Handed off` banner), it is the PRD, with one line naming what it replaced, and the issue it touched; the map stays as history.

The ticket is the primary source for what was believed at the time, and the PRD links back to it. Rewriting it destroys the record — and the reason the first answer turned out wrong is usually the most useful thing in it.
