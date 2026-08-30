---
name: wayfinder
description: Chart a huge chunk of work (more than one agent session can hold) as a map of decision tickets, and resolve them one at a time until the way to the destination is clear. Use when an idea is too big and too foggy to plan in a single session.
disable-model-invocation: true
---

# Wayfinder

A loose idea has arrived, too big for one agent session, and wrapped in fog: the way from here to the **destination** isn't visible yet. Wayfinding is about finding that way, not charging at the destination. This skill charts the way as a **map** under `.scratch/`, then works its **decision tickets** (questions whose resolution is a decision, not slices of a build to execute) one at a time until the route is clear.

The destination varies per effort, and naming it is the first act of charting: it shapes every ticket. Most often here it's a PRD to hand to `to-prd`; it might also be a decision to lock before planning starts, or a change made in place like a data-structure migration.

Before doing anything else, use the read tool to load `~/.pi/agent/skills/issue-tracker.md` in full — its **Wayfinding operations** section defines where the map, tickets, blocking, and the frontier physically live.

## Where this sits in the workflow

Wayfinder runs **before** `to-prd`, and only when the idea won't fit in one session:

```
loose idea → wayfinder map (decisions, HITL, one ticket per session)
           → to-prd → PRD.md
           → to-issues → .scratch/<effort>/issues/
           → /goal (execution, AFK)
```

If the way to the destination is already clear enough to hold in one head, skip this skill and go straight to `to-prd`.

Wayfinder tickets live in `tickets/`, never in `issues/`. The `/issue` and `/goal` pickers scan `issues/` and will try to TDD-implement anything they find there — a decision ticket landing in that directory is a bug, not a shortcut.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the map is done when the way is clear, with nothing left to decide before someone goes and does the thing. The pull to just do the work is usually the signal you've reached the edge of the map and it's time to hand off. An effort can override this in its **Notes**, carrying execution into the map itself, but absent that, produce decisions, not deliverables.

## Refer by name

Every map and ticket is a file, so it has a **name**: its title. In everything the human reads (narration, the map's Decisions-so-far), refer to it by that name, never by a bare number, path, or slug. A wall of `03, 04, 05` is illegible; names read at a glance. The path doesn't vanish — a name wraps its link, but the path rides _inside_ the name and never stands in for it.

## The map

The map is `.scratch/<effort-slug>/MAP.md`, the canonical artifact. It is an **index**, not a store: it lists the decisions made and points at the tickets that hold their detail, so a decision lives in exactly one place. The map never restates a decision, only gists it and links.

This is what makes the next session cheap — it loads one page and zooms only where it needs to.

### The map body

The whole map at low resolution, loaded once per session. Open tickets are **not** listed: they live in `tickets/` and are found by reading that directory.

```markdown
# <effort name>

## Destination

<what reaching the end of this map looks like: the PRD, decision, or change this
effort is finding its way to. One or two lines; every session orients to it
before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then open
     the link for the detail the ticket holds -->

- [<closed ticket title>](tickets/NN-slug.md): <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates -->
```

### Tickets

Each ticket is a file in `tickets/`, and its body is the question, sized to **one session**:

```markdown
---
type: grilling
status: open
blocked-by: []
---

# <title>

## Question

<the decision or investigation this ticket resolves>

## Assets

<!-- links to prototype branches and research notes, added while resolving -->

## Resolution

<!-- filled in on close -->
```

A ticket is **unblocked** when every ticket in its `blocked-by` is closed; the **frontier** is the open, unblocked tickets — the edge of the known.

Assets created while resolving a ticket are **linked** from the ticket, not pasted into it: a research note under `research/`, a prototype on its own branch. The answer goes in `## Resolution` when the ticket closes, not in the body while it's open.

## Ticket types

Every ticket is either **HITL** (worked _with_ a human who speaks for themselves) or **AFK**, driven by the agent alone. A HITL ticket only resolves through that live exchange; the agent never stands in for the human's side of it. A grilling session that answers its own questions has broken this.

- **`research`** (AFK) — Reading documentation, third-party APIs, or local resources to surface a fact a decision waits on. Resolved by invoking the `research` skill, which backgrounds the reading. Use when knowledge outside the working directory is required.
- **`prototype`** (HITL) — Raise the fidelity of the discussion by making a cheap, rough, concrete artifact to react to. Invoke the `prototype` skill; link the branch it produces under `## Assets`. Use when "how should it look" or "how should it behave" is the key question.
- **`grilling`** (HITL) — Conversation. The default case. Invoke the `grill-me` skill.
- **`task`** (HITL or AFK) — Manual work that must happen before a _decision_ can be made: nothing to decide, prototype, or research, but the discussion is blocked until it's done. Signing up for a service so its API can be judged, provisioning access, moving data so its shape can be seen. This is the one type that _does_ rather than decides, and it earns its place by unblocking a decision, not by delivering the destination. Drive it alone where you can; otherwise hand the human a precise checklist. The resolution records what was done and any facts later tickets depend on (where credentials live, new URLs, row counts).

`task` tickets never become issues — they're neither decisions nor implementation slices. They get done during wayfinding and disappear.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see. Beyond the live tickets lies the **fog of war**: the dim view of decisions you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets, until the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down: the suspected question, the area to revisit later. Everything there is in scope, just not sharp enough to ticket. It doubles as a signpost for anyone reading where the effort is headed.

**Fog or ticket?** The test is whether you can state the question precisely now, _not_ whether you can answer it now.

- **Ticket** when the question is already sharp, even if it's blocked and you can't act on it yet.
- **Not yet specified** when you can't phrase it that sharply. Don't pre-slice the fog into ticket-sized pieces: it's coarser than a ticket, and one patch may graduate into several tickets, or none, once the frontier reaches it.

**Not yet specified** excludes what's already decided, what's already a live ticket, and what's out of scope.

## Out of scope

Fog only ever gathers _toward_ the destination. The destination fixes the scope, so work beyond it is **out of scope**: it isn't fog, and it doesn't belong in **Not yet specified**. Scope, not sharpness, lands it there.

Out-of-scope work never graduates, so it returns only if the destination is redrawn, and then as a fresh effort, not a resumption.

When a ticket that already exists turns out to sit past the destination (mis-scoped while charting, or exposed by a resolution), **close it** and leave one line in **Out of scope**: the gist plus why it's out, linking the closed ticket. It stays out of **Decisions so far**, which records the route actually walked; a scope boundary isn't a step on it.

The **Out of scope** section carries straight into the PRD's own Out of scope section when the map is handed off.

## Sessions

**Never resolve more than one ticket per session**, with the exception of `research` tickets, which run as background agents and cost you nothing.

The boundary is a ticket:

- **Charting is its own session.** It ends when the map exists and the research agents are running. Resolving a ticket in the charting session is a mistake twice over — the breadth-first grilling has already eaten the context, and you're still in survey mode, which is the wrong mode for deciding.
- **Each `grilling`, `prototype`, and `task` ticket is one session.** Load `MAP.md`, zoom only into the closed tickets that matter, resolve, record, stop.
- **Stop when the ticket is recorded.** The temptation right then is "the next ticket just unblocked, let's keep going" — that's exactly what this rule exists to stop, because your judgment on the next ticket is now soaked in the last one's specifics.

**Context pressure means the ticket was too big — split it, don't resume it.** This inverts the `/goal` loop, which aborts near the context limit, writes a handoff, and respawns on the same issue. That works because implementation is AFK. Wayfinding is mostly HITL, and respawning mid-grilling drops the human into a conversation with no memory of the last hour of dialogue. So when a ticket runs long: record what _is_ settled as its resolution, close it, and create a follow-up ticket for the remainder.

## Invocation

### Chart the map

The user invokes with a loose idea.

1. **Name the destination.** Invoke `grill-me` to pin down what this map is finding its way to: the PRD, decision, or change. The destination fixes the scope, so it's settled first.
2. **Map the frontier.** Grill again, **breadth-first** this time: fan out across the whole space rather than deep on any one thread, surfacing the open decisions and the first steps takeable now. **If this surfaces no fog** — the way is already clear, the whole journey small enough for one session — you don't need a map. Stop, say so, and point at `to-prd`.
3. **Create the map**: Destination and Notes filled in, Decisions-so-far empty, the fog sketched into **Not yet specified**.
4. **Create the tickets you can specify now**, then wire `blocked-by` in a **second pass** (tickets need numbers before they can reference each other). Wiring sorts them into the frontier and the blocked; everything you can't yet specify stays in the fog.
5. **Fire the research tickets.** Invoke the `research` skill for each one so they resolve in parallel while the rest of the map waits.
6. **Stop.** Charting is one session's work; it hand-resolves nothing.

### Work through the map

The user invokes with an effort slug or a map path. A ticket is **optional**: without one, you pick the next decision, not the user.

1. Load `MAP.md` — the low-res view, not every ticket body.
2. Choose the ticket. If the user named one, use it; otherwise take the first frontier ticket in number order.
3. Resolve it. **Zoom as needed**: read the full body of any related or closed ticket on demand, and invoke whichever skills the ticket's type and the map's `## Notes` call for.
4. Record the resolution: write the answer into the ticket's `## Resolution`, set `status: closed`, and append a one-line gist plus link to the map's **Decisions so far**.
5. Add newly-surfaced tickets (create, then wire); graduate any fog the answer has made specifiable, clearing each graduated patch from **Not yet specified** so it lives only as its new ticket. If the answer reveals a ticket sits beyond the destination, **rule it out of scope** rather than resolving it. If the decision invalidates other tickets, update or delete them.

### Reach the destination

The map is done when the frontier is empty and **Not yet specified** is empty. In practice a softer signal fires first, and it's the one to trust: when two or three tickets in a row resolve into "that's an implementation detail, whoever builds it can call it," you're done deciding. That remaining fog is implementation unknown, not decision, and it belongs in an issue's plan, not in more tickets. Charting past that point pre-empts decisions the implementer should be making with the code in front of them.

Either way, hand off — don't keep wayfinding:

1. Invoke `to-prd`. It reads `MAP.md` and every closed ticket, so the decisions carry over without re-interviewing the user; the interviewing already happened, ticket by ticket.
2. Then `to-issues` as normal, and the effort leaves the map for `issues/`.

Leave the map and its tickets in place. They're the primary sources behind the PRD, and the PRD links back to them.
