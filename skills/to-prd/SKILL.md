---
name: to-prd
description: Turn the current conversation context into a PRD and publish it to the project issue tracker. Use when user wants to create a PRD from the current context.
---

This skill takes the current conversation context and codebase understanding and produces a PRD. Do NOT interview the user — just synthesize what you already know.

Before doing anything else, read `~/.pi/agent/skills/issue-tracker.md` in full to load issue tracker conventions and labels.

## Process

0. Load issue tracker conventions (mandatory)

Use the read tool to load `~/.pi/agent/skills/issue-tracker.md` at the start of every run.

0b. Load the map, if there is one

If `.scratch/<effort-slug>/MAP.md` exists, this PRD is the destination of a wayfinder map, and its decisions are on disk rather than in your context — they were resolved in sessions you never saw. Read `MAP.md` and the full body of every closed ticket before writing anything. Then:

- The map's **Destination** and **Decisions so far** are the raw material for Problem Statement, Solution, and Implementation Decisions
- The map's **Out of scope** carries into the PRD's Out of scope, near-verbatim
- Prototype branches linked from tickets are the source for the prototype-snippet exception below
- Closed **`seam`** tickets have already settled their interfaces. Their `## Resolution` holds the chosen shape as code — copy it into Implementation Decisions verbatim. Do not re-describe a settled interface in prose; the prose version is the one that gets reversed.
- Where a ticket settled a design, it links a **design transcript** under `## Assets`. That transcript is the spec for the surface it covers. Cite it by path from the relevant Implementation Decision and say plainly that it is binding — do not paraphrase it into the PRD, and do not restate its details in prose, which is exactly how they get lost
- Research notes under `research/` get cited in Further Notes

Still do not interview the user: the interviewing already happened, ticket by ticket.

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the PRD, and respect any ADRs in the area you're touching.

2. Sketch out the major modules you will need to build or modify to complete the implementation. Actively look for opportunities to extract deep modules that can be tested in isolation.

A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes.

Where a `seam` ticket settled an interface, that shape is already decided — carry it, don't re-open it. Where one didn't and the interface is expensive to reverse, show the user the **signature**, not a description of it, and the call sites it produces. A sentence about where a field sits or how a parameter threads is not a settled interface, however confident it sounds.

Check with the user that these modules match their expectations. Check with the user which modules they want tests written for.

3. Write the PRD using the template below, then publish it to the project issue tracker. Apply the `ready-for-agent` triage label - no need for additional triage.

<prd-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Two exceptions, both for decisions prose cannot carry precisely:

- **A settled interface is carried as its shape, verbatim.** Signatures, type declarations, endpoint contracts, table-and-column sketches — from a `seam` ticket's resolution where there is one. Never re-describe it in prose.
- **A prototype snippet that encodes a decision more precisely than prose can** (state machine, reducer, schema, type shape) is inlined within the relevant decision, noting briefly that it came from a prototype.

In both cases trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.

</prd-template>
