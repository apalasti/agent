---
name: to-prd
description: Turn the current conversation context, or a finished wayfinder map, into a PRD. Use when the user wants a PRD written, or a wayfinder map handed off.
---

Synthesize what you already know; do not interview the user.

## Process

### 0. Load issue tracker conventions (mandatory)

Read `~/.pi/agent/skills/issue-tracker.md` in full at the start of every run.

### 1. Load the map, if there is one

If `.scratch/<effort-slug>/MAP.md` exists, read [from-map.md](from-map.md) and follow it before step 2.

### 2. Explore the codebase

Explore the repo to understand the current state of the codebase, if you haven't already. Use the vocabulary in `GLOSSARY.md` (if it exists) throughout the PRD, and respect any ADRs in the area you're touching.

### 3. Sketch the modules and the seams under test

Sketch the major modules you will build or modify. Look for opportunities to extract **deep modules** (see the `codebase-design` skill).

Where a `seam` ticket settled an interface, that shape is already decided: carry it, don't re-open it. Where one didn't and the interface is expensive to reverse, show the user the **signature**, not a description of it, and the call sites it produces. A sentence about where a field sits or how a parameter threads is not a settled interface, however confident it sounds.

Then pick the **seams under test**: the interfaces the tests will drive. Prefer existing seams to new ones, and the highest seam that reaches the behaviour. The fewer the better; the ideal is one.

Show the user the modules and the seams under test, and adjust until they match the user's expectations. This is a checkpoint on your synthesis, not an interview, so it runs after a map too.

### 4. Write the PRD

Write the PRD using the template below to `.scratch/<feature-slug>/PRD.md`. It is not an issue: it goes beside `issues/`, never inside it.

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

- The seams under test from step 3, and why each is the highest one that reaches its behaviour
- Prior art for the tests (similar tests already in the codebase)

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.

</prd-template>
