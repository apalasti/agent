---
name: to-prd
description: Turn the current conversation context, or a finished wayfinder map, into a PRD and publish it to the project issue tracker. Use when the user wants a PRD written, or a wayfinder map handed off.
---

Synthesize what you already know; do not interview the user.

## Process

0. Load issue tracker conventions (mandatory)

Read `~/.pi/agent/skills/issue-tracker.md` in full at the start of every run.

0b. Load the map, if there is one

If `.scratch/<effort-slug>/MAP.md` exists, read [from-map.md](from-map.md) and follow it before step 1.

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the PRD, and respect any ADRs in the area you're touching.

2. Sketch out the major modules you will need to build or modify to complete the implementation. Actively look for opportunities to extract deep modules that can be tested in isolation.

A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes.

Where a `seam` ticket settled an interface, that shape is already decided — carry it, don't re-open it. Where one didn't and the interface is expensive to reverse, show the user the **signature**, not a description of it, and the call sites it produces. A sentence about where a field sits or how a parameter threads is not a settled interface, however confident it sounds.

Check with the user that these modules match their expectations. Check with the user which modules they want tests written for.

3. Write the PRD using the template below, then publish it to the project issue tracker.

<prd-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

An exhaustive, numbered list of user stories covering every aspect of the feature, each in the format:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Leave out file paths and code, except for the decisions the issue tracker's **Decisions prose cannot carry** lists.

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
