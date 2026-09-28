---
name: review-map
description: "Turn a large diff into a review map: a guided, outside-in reading order for a human reviewer. Use when a diff or PR is too big to read linearly, or the user asks where to start reviewing."
---

A big diff read in `git diff` order is read in alphabetical order, which is no order at all. This skill produces a **route through the change**: first an orientation brief, then a short ordered list of stops, outside-in, so the reviewer meets every contract and seam before the code that honours it.

It is **navigational only**. It says "read this next, and watch this" — never "this is a bug". Judgement belongs to the human reading, or to a code review afterwards.

The reading legwork runs in **Explore sub-agents**, so this session holds the map and not the diff.

## Four rules that decide whether the map is any use

**Write for a reviewer who has never seen this code.** Assume no familiarity with the repo, the feature, or the vocabulary. Every file, type, function, module or concept gets introduced the first time it appears: what it is, whether it's new or pre-existing, and what role it plays. A line like "the new `RunProvider` wraps the solve page and owns run parameters, replacing the props-drilling in `SolutionPage`" is a map; "new `RunContext`/`RunProvider`, `solve.ts`, `transformRecomParams.ts`" is a file list pretending to be one. If a name appears with no gloss, the map has failed.

**Write it in plain, simple English — in the first draft.** Use ASD-STE100 Simplified Technical English. That means:

- One idea per sentence. Around 20 words is the ceiling.
- Active voice, present tense, and a real subject doing a real thing.
- The project's own vocabulary. Never invent a term for something the code already names.
- No stacked parentheticals, no em-dash asides, no definition wedged inside another sentence. A term that needs defining gets its own line in the vocabulary list, before its first use.
- Say it once. A precise sentence does not need a restatement in different words.

Dense, clause-heavy prose is the common failure here. It reads as though it explains, and the reviewer still has to ask "wait, what?". Assume there is no second attempt.

**Anchor every concept to a place in the tree.** A concept the reviewer cannot open is a dead end. So each term, each handoff step, and each stop carries the path where the thing lives, written `path/to/file.ts:Symbol` — or `path/to/file.ts:120` when there's no name worth citing. The map is for navigating with, so the reader should never have to grep to find what a sentence is about.

**Order by the cost of a mistake, which is why outside-in works.** At the seams — schemas, contracts, who-owns-what, how the pieces hand off — a mistake is structural and expensive, and it's invisible in any single file. Deeper down, mistakes shrink into nuance and preference. So the tour front-loads the expensive questions and says, per stop, which kind of mistake is in play, letting the reviewer stop when the payoff drops off.

## Process

### 1. Pin the fixed point

Whatever the user named is the fixed point (a SHA, branch, tag, `main`, `HEAD~5`). If they didn't name one, ask.

Confirm it resolves (`git rev-parse`), then gather **only cheap shape data** here:

- `git diff --stat <fixed-point>...HEAD`
- `git log <fixed-point>..HEAD --oneline`

Never pull the full diff into this session. Three-dot diff excludes uncommitted work; if the change isn't committed, say so and ask the user to commit.

### 2. Chart the change

Spawn **one Explore sub-agent** to chart it before any of it gets described. Its brief:

- **Intent**: what is this change for, in plain language? Source it from the commit messages, any referenced issue, the tests, and the code itself — not from guesswork about the names.
- **The flows, as numbered chains of handoffs**: pick the real paths through the change — a user action or a request, followed to what the user finally sees. Then one numbered step per piece each path passes through. Each step names the piece with its path, what reaches it, what it does with it, and what it passes on. Prose paragraphs are not acceptable here; the handoffs must be countable.
- Most changes have more than one path. Cover the main one first, then a short chain for each other path the change touches (a read path as well as a write path, a defaults path, a background job). Three chains is plenty; if there are more, the change has more than one concern in it and that is worth saying.
- **What changed in the flow**: mark each step that this change added, moved, or reshaped, and say what used to happen there. A handoff that moved is where the expensive mistakes live, so the before/after matters more than the step itself.
- Where the change adds a new seam (a provider, a service, a table, an endpoint), say what it took over and from whom.
- **Dependency direction** among the changed files: which changed files import which. Outer means imported-by, not imported-from.
- **Clusters**: groups of changed files serving one concern (one endpoint, one table and its accessors, one screen), each with its layer depth.
- **Mechanical files**: generated, vendored, mass-renamed, or formatting-only (lockfiles, snapshots, `types.gen.ts`, openapi dumps).

Require plain language and no bare identifiers in the reply: every name it reports must come with what the thing is and the path where it lives.

Depth ordering, outermost first, as a default to be overridden by what the agent finds: persistence and schema → shared types and contracts → API routes and handlers → pages and top-level components → hooks, services, stores → leaf utilities.

If the change has no depth (a pure refactor, a sweep across peers), say so and order by **blast radius** instead: whatever the most other files depend on comes first.

### 3. Check the premise with the user

Show, in this order:

1. The terms, one line each with a path.
2. What you understand the change to be doing.
3. **The handoff chains from step 2, in full.** Not a summary of them — the numbered steps, with the added, moved and reshaped ones marked. How the pieces interact is the single most valuable thing to get corrected early, so it belongs in the checkpoint and not only in the final map.
4. The order you intend to walk the stops, and what's in the skim bucket.

This checkpoint catches a wrong premise, so a list of symbols defeats it — and so does dense prose. The writing standard applies here first. Let the user correct before you spend agents on the stops.

Cap the tour at **8 stops**. More than that means clusters need merging, not a longer list.

### 4. Describe each stop

Spawn Explore sub-agents **in parallel, one per stop**, each scoped to its cluster's files, and each given the intent and flow from step 2 so its stop fits the whole. Each reads the hunks in its cluster — **including its tests, which are the best evidence of intended behaviour** — and reports, under 250 words:

- **Entry point** — the single `path:Symbol` a reviewer should open first to understand this stop, and one line on why.
- **What this is** — the subject of the stop explained from zero: what it is, new or pre-existing, what calls it, what it calls.
- **How it connects** — what reaches this stop and from which stop, what it produces, and which stop consumes that, each named with its path. The interaction story has to hold at every level, not only in the opening brief.
- **What changed** — the shape of the change, not a line-by-line recital.
- **Why it matters** — what downstream code or data this stop's decisions bind, and which other stops would be wrong if this one is.
- **What to watch for** — the specific thing that would be wrong if it were wrong here: a contract that widened, a nullable that appeared, an auth check that moved, a default that changed, a case the flow doesn't cover.
- **Untested behaviour** — behaviour the cluster added that its tests don't reach.

End every prompt with: "Cite a path for every file, type or function you mention, as `path/to/file.ts:Symbol`, or with a line number where there's no useful name. Explain every name you use; assume the reader has never seen this codebase. Write in ASD-STE100 Simplified Technical English: one idea per sentence, about 20 words maximum, active voice, the project's own vocabulary, no stacked parentheticals. Do not invoke any skill and do not spawn further sub-agents. Report only what the diff shows; do not pass judgement on quality."

### 5. Lay out the map

**Open with the orientation brief**, before any stop:

- **Vocabulary first**: every domain term and identifier the reviewer will meet repeatedly. One short line each, and the path where the thing is defined. This comes before the prose so nothing later needs an inline definition.
- **What this change does**, in a few simple sentences a newcomer can follow.
- **How the pieces interact**: the handoff chains from step 2, carried over with whatever the user corrected. One step per piece, in order, each with the piece's path, what comes in, what the piece does, and what goes out. Steps this change added, moved or reshaped stay marked, with what used to happen there. Read top to bottom, a chain doubles as the list of places to open.
- **Which stop owns which step**: map the chain's steps onto the numbered stops, so the reviewer can see the tour as a second pass over the same flow rather than an unrelated list.
- **What's new vs. what moved**: which pieces didn't exist before, and which responsibilities changed hands.

Then the **tour**, as an ordered walk. Per stop: a name in plain language, an **entry point** (the one `path:Symbol` to open first, and why it's the way in), the rest of the stop's files as paths — collapse only the long tail of near-identical ones to a directory plus count — the fields from its agent, and a **leverage label** — `design` (a mistake here is structural and costly), `integration` (a mistake here is a mismatch between pieces), or `nuance` (preference and polish). Put a line where the labels turn to `nuance`, so the reviewer knows where the high-value reading ends.

Close with:

- **Skim** — real changes that follow mechanically from a stop above; name the stop they follow from.
- **Skip** — generated, vendored, or formatting-only files, with the reason.
- **Cross-cutting** — anything showing up in several stops that's better held in mind than re-derived (a renamed field, a new error type, a changed default).

State the assumption the order rests on, in one line, so a reviewer who knows better can reorder.

## Keep it a map

- **Hold sub-agents to the rules.** If one returns symbol soup, send it back or expand it yourself from the files. If one returns a judgement, strip it: "watch for" points at a risk, never asserts a defect.
- **Targets, not inventories.** A stop is a concern, not a file list. Ten files under one concern is one stop — but the concern still names the file to open first, and never hides a path the reviewer needs.
- **Every stop earns its place.** If you can't say what the reviewer would miss by skipping it, it belongs in Skim.
- **Hand off, don't merge.** When the user wants findings rather than direction, that is a code review; say so instead of drifting into it.
