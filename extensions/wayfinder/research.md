You have been assigned a wayfinder **research** ticket: a fact outside the working directory that a decision waits on.

Ticket file: `{{ticket_path}}`
Map file: `{{map_path}}`

## Phase 0: Load the conventions (mandatory)

1. Use the read tool to load `~/.pi/agent/skills/wayfinder/SKILL.md` in full
2. Use the read tool to load `~/.pi/agent/skills/issue-tracker.md` in full — its **Wayfinding operations** section defines where the map, tickets, blocking, and the frontier live

## Phase 1: Orient

1. Read `{{map_path}}` — the low-resolution view. Note the **Destination**: every choice in this session serves it.
2. Read the **Notes** section and consult any skills it names
3. Read the ticket file
4. Zoom only where you must: read the full body of a closed ticket when this ticket depends on its decision. Do not read every ticket.

Refer to the map and to each ticket by its **title**, never by a bare number, path, or slug.

## Phase 2: Research

Invoke the `research` skill with the ticket's `## Question`. It backgrounds the reading and writes its findings to a Markdown file.

Put the findings under `{{effort_dir}}/research/` and link that file from the ticket's `## Assets`. Do not paste the findings into the ticket.

## Phase 3: Answer the question

Write the answer to the question, not a summary of the reading. The resolution must be short enough that a later session can act on it without opening the research note.

## Phase 4: Record the resolution

1. Write the answer into the ticket's `## Resolution` section
2. Set the ticket frontmatter `status` to `closed`
3. Append one line to the map's **Decisions so far**: the ticket title as a link, then a one-line gist of the answer. Gist it — never restate the decision in the map.
4. Add any newly-surfaced tickets: create them first, then wire `blocked-by` in a second pass
5. Graduate any fog the answer has made specifiable into fresh tickets, and clear each graduated patch from **Not yet specified**
6. If the answer shows a ticket sits past the destination, close it and add one line to **Out of scope** instead of resolving it
7. If the decision invalidates other tickets, update or delete them

## Phase 5: Stop

**Stop when the ticket is recorded.** Do not start the next ticket, even one this resolution just unblocked. Your judgement on it is now soaked in this ticket's specifics. Tell the user what is now on the frontier, and stop.

## Rules

- **One ticket per session.** This is the whole point of the boundary.
- **Plan, do not do.** The deliverable is a decision, not code. The pull to just build the thing is the signal that you have reached the edge of the map.
- Context pressure means the ticket was too big. Do not push through it: record what *is* settled as the resolution, close the ticket, and create a follow-up ticket for the rest.
- Assets are **linked** from `## Assets`, never pasted into the ticket.

## One exception to the one-ticket rule

Research tickets run as background agents and cost you no context, so **several may run in parallel**. If other research tickets sit on the frontier, fire them too. This exception covers research tickets only: a `grilling`, `prototype`, or `task` ticket still ends the session.
