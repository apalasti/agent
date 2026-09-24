You have been assigned a wayfinder **seam** ticket: an interface question, settled by rendering the interface and reacting to it with the user.

Ticket file: `{{ticket_path}}`
Map file: `{{map_path}}`

## Phase 0: Load the conventions (mandatory)

1. Use the read tool to load `~/.pi/agent/skills/wayfinder/SKILL.md` in full
2. Use the read tool to load `~/.pi/agent/skills/issue-tracker.md` in full — its **Wayfinding operations** section defines where the map, tickets, blocking, and the frontier live

## Phase 1: Orient

1. Read `{{map_path}}` — the low-resolution view. Note the **Destination**: every choice in this session serves it.
2. Read the **Notes** section and consult any skills it names
3. Read the ticket file
4. **Read the closed ticket this one was graduated from**, in full. It carries the requirement this interface has to serve — you are settling the shape that satisfies it, not revisiting what it must do.
5. Zoom only where you must: read the full body of a closed ticket when this ticket depends on its decision.

Refer to the map and to each ticket by its **title**, never by a bare number, path, or slug.

## Phase 2: Render

The whole point of this ticket type is that the user is reacting to a **shape they can see**, not to a description of one. Prose about where a field sits or how a parameter threads is what this session exists to avoid producing.

1. **Pull what exists today from the codebase, not from memory.** The real signature, the real type, the real table. If the interface is new, say so and render what it would sit next to.
2. **Build two candidates.** Not one with a rationale — two. Even when you are confident, the alternative is what makes the choice legible, and it is often what the user picks.
3. For each candidate, render:
   - **The shape.** The signature, type declaration, endpoint, or table-and-column sketch, as code.
   - **What calls it.** Every call site this candidate produces or changes. For a data model, the access patterns instead: the reads each surface needs, the writes, what is unique, what cascades.
   - **One line saying what it does.** If that line will not stay one line, *that is the finding* — report it rather than padding the description. An interface that needs a paragraph is telling you it is the wrong interface.
   - **The deletion test.** Delete this thing: does complexity vanish (it is a pass-through — cut it), or move to the callers (it earns its keep)?

Watch for the shapes the user reliably rejects: a flag riding on a base that most consumers do not want, an optional parameter only one caller ever passes, a component that takes pre-rendered presentation instead of data.

## Phase 3: React with the user

This is a HITL ticket. Show both candidates and settle the ticket's `## Question` against what the user sees. **Do not pick one alone**, and do not present one with the other as a token alternative.

## Phase 4: Record the resolution

1. Write into the ticket's `## Resolution`: **the chosen shape as code, verbatim** — never a description of it — then the rejected candidate and one line on why it lost. The loser is worth keeping: it is what lets the next reader re-examine the choice instead of re-deriving it.
2. Set the ticket frontmatter `status` to `closed`
3. Append one line to the map's **Decisions so far**: the ticket title as a link, then a one-line gist. Gist it — the shape lives in the ticket, never restated in the map.
{{map_bookkeeping}}

## Phase 5: Stop

**Stop when the ticket is recorded.** Do not start the next ticket, even one this resolution just unblocked. Tell the user what is now on the frontier, and stop.

## Rules

- **One ticket per session.**
- **Render, do not build.** The deliverable is a settled shape, not a working implementation. Stubs and sketches only — enough to read, not to run.
- **Two candidates, always.** A single option is a recommendation, and the user cannot judge a recommendation against an alternative they have not seen.
- **If this question is cheap to reverse, it is mis-typed.** A shape that is reversible inside one session, internal to a single issue, with no persistence and no consumers beyond it, does not belong on the map — it belongs in an issue's plan, settled with the code in front of whoever writes it. Say so, close the ticket out of the map, and move on.
- Context pressure means the ticket was too big. Record what *is* settled, close it, and create a follow-up for the rest.
- Assets are **linked** from `## Assets`, never pasted into the ticket.
