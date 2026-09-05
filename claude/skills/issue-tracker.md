# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
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

## Wayfinding operations

The `wayfinder` skill charts a large, foggy effort as a map of decision tickets. Those tickets are **decisions, not work**, so they live apart from implementation issues:

```
.scratch/<effort-slug>/
├── MAP.md          # the map — one per effort, the canonical artifact
├── tickets/
│   └── <NN>-<slug>.md
├── research/
│   └── <slug>.md   # findings from research tickets
├── spec.md         # the usual destination, written by to-spec once the map is done
└── issues/
    └── <NN>-<slug>.md
```

**Never put a wayfinder ticket in `issues/`.** The `/issue` command scans `issues/` and treats everything not `done` as implementable, so a decision ticket there gets picked up and TDD-implemented.

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
| `type` | `research`, `prototype`, `grilling`, `task` |
| `status` | `open`, `closed` |
| `blocked-by` | ticket numbers, `[]` if none |
| `claimed` | ISO timestamp, optional — only needed when running parallel sessions |

Ticket numbers are their `NN` prefix, numbered from `01`, in a sequence separate from `issues/`.

### Blocking and the frontier

There is no native dependency relationship here, so `blocked-by` in the frontmatter is the fallback convention. A ticket is **unblocked** when every number in its `blocked-by` refers to a `status: closed` ticket. The **frontier** is the open, unblocked tickets — computed by reading `tickets/` and checking each one's blockers.

The cost of the fallback is that the frontier isn't visible without reading the directory. Keep `MAP.md` short enough to compensate.

### Resolving a ticket

There are no comments, so the resolution is written into the ticket's own `## Resolution` section. Closing a ticket is three edits:

1. Write the answer into `## Resolution`
2. Set `status: closed`
3. Append one line to the map's **Decisions so far**: `- [<title>](tickets/NN-slug.md): <gist>`

Assets are linked from `## Assets`, never pasted in: research notes as paths under `research/`, prototypes as the branch name the `prototype` skill produced.
