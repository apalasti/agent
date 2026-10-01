You have been asked to chart a new wayfinder map.

The idea: **{{idea}}**

Efforts live under `{{scratch_dir}}/<effort-slug>/`.

## Phase 0: Load the conventions (mandatory)

1. Use the read tool to load `~/.pi/agent/skills/wayfinder/SKILL.md` in full
2. Use the read tool to load `~/.pi/agent/skills/issue-tracker.md` in full — its **Wayfinding operations** section defines where the map, tickets, blocking, and the frontier live

## Phase 1: Name the destination

Invoke the `grill-me` and `domain-modeling` skills and pin down what this map is finding its way to: a PRD, a decision to lock before planning starts, or a change made in place.

The destination fixes the scope, so it is settled first. Everything past it is out of scope, not fog.

**STOP. Wait for the user to confirm the destination.**

## Phase 2: Brief the user on how it works today

Before any design question, the user needs to understand the part of the system the idea touches. This is the one exploration charting **waits for**.

1. Dispatch Explore sub-agents to trace, for the area the idea touches:
   - the entry points, and the path one value takes from where it originates to where it is consumed
   - where this idea would plug in: the existing interfaces, hooks, and data it would reuse
   - relevant history (`git log -S <symbol>`): why it is the way it is, and what changed recently
   - what does **not** exist that the idea would need (identity, storage, notifications, …)
2. Wait for them. Then pick the effort slug and write `{{scratch_dir}}/<effort-slug>/briefing.md`, **for the user, not for agents**: plain explanation first, every claim anchored by path + symbol, each claim marked **verified** (read in code) or **inferred** (assumed from names or partial reading).
3. Present it.

**STOP. Wait for the user to read it and correct anything wrong.** A correction here costs a line; the same misunderstanding found three tickets later costs every decision built on it.

## Phase 3: Choose the approach

Lay out 2–3 approaches the briefing makes possible. They must differ in something expensive to change once tickets build on it, not in details a ticket could settle later. For each:

- a few lines on how it would work
- rough cost: which areas change, what new infrastructure it needs (tables, services, notification paths, …)
- **premises**: the briefing claims it depends on. If one of them is false, the approach is dead

If the facts decide between them, recommend one and say why; otherwise say it is a preference call.

**STOP. Wait for the user to choose.**

## Phase 4: Map the frontier

Grill again, **breadth-first** this time, within the chosen approach only. Fan out across the whole space rather than deep on any one thread. You are surfacing the open decisions and the first steps takeable now, not resolving any of them.

**If this surfaces no fog** — the way is already clear and the whole journey fits in one session — you do not need a map. Say so, point the user at `to-prd`, and stop. Do not create files.

**STOP. Show the user the decisions and the fog you found, and wait.**

## Phase 5: Create the map

Only after the user approves the shape.

1. Create `{{scratch_dir}}/<effort-slug>/MAP.md` with **Destination**, **Approach** (the choice, its premises linked into `briefing.md`, and one line per rejected approach) and **Notes** filled in, **Decisions so far** empty, and the fog written into **Not yet specified**
2. Create the tickets you can specify now under `tickets/`, numbered from `01`
3. Check that no question appears in two tickets. If two tickets both need the same question answered, pull it out into its own ticket and make it block both. Frontier tickets may run in parallel sessions, and a shared question gets asked, and answered differently, in each.
4. Wire `blocked-by` in a **second pass** — tickets need numbers before they can reference each other

Ticket or fog? The test is whether you can state the question **precisely now**, not whether you can answer it now. Do not pre-slice the fog into ticket-sized pieces.

## Phase 6: Fire the research tickets

Invoke the `research` skill for each `research` ticket, so they resolve in parallel while the rest of the map waits.

## Phase 7: Stop

**Charting is one session's work and it hand-resolves nothing.** Resolving a ticket now is a mistake twice over: the breadth-first grilling has already eaten your context, and you are still in survey mode, which is the wrong mode for deciding.

Tell the user what is on the frontier, and stop.
