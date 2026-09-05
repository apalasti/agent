You have been asked to chart a new wayfinder map.

The idea: **{{idea}}**

Efforts live under `{{scratch_dir}}/<effort-slug>/`.

## Phase 0: Load the conventions (mandatory)

1. Use the read tool to load `~/.pi/agent/skills/wayfinder/SKILL.md` in full
2. Use the read tool to load `~/.pi/agent/skills/issue-tracker.md` in full — its **Wayfinding operations** section defines where the map, tickets, blocking, and the frontier live

## Phase 1: Name the destination

Invoke the `grill-me` skill and pin down what this map is finding its way to: a PRD, a decision to lock before planning starts, or a change made in place.

The destination fixes the scope, so it is settled first. Everything past it is out of scope, not fog.

**STOP. Wait for the user to confirm the destination.**

## Phase 2: Map the frontier

Grill again, **breadth-first** this time. Fan out across the whole space rather than deep on any one thread. You are surfacing the open decisions and the first steps takeable now, not resolving any of them.

**If this surfaces no fog** — the way is already clear and the whole journey fits in one session — you do not need a map. Say so, point the user at `to-prd`, and stop. Do not create files.

**STOP. Show the user the decisions and the fog you found, and wait.**

## Phase 3: Create the map

Only after the user approves the shape.

1. Create `{{scratch_dir}}/<effort-slug>/MAP.md` with **Destination** and **Notes** filled in, **Decisions so far** empty, and the fog written into **Not yet specified**
2. Create the tickets you can specify now under `tickets/`, numbered from `01`
3. Wire `blocked-by` in a **second pass** — tickets need numbers before they can reference each other

Ticket or fog? The test is whether you can state the question **precisely now**, not whether you can answer it now. Do not pre-slice the fog into ticket-sized pieces.

## Phase 4: Fire the research tickets

Invoke the `research` skill for each `research` ticket, so they resolve in parallel while the rest of the map waits.

## Phase 5: Stop

**Charting is one session's work and it hand-resolves nothing.** Resolving a ticket now is a mistake twice over: the breadth-first grilling has already eaten your context, and you are still in survey mode, which is the wrong mode for deciding.

Tell the user what is on the frontier, and stop.
