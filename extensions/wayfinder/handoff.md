The map for **{{effort}}** has an empty frontier. Every ticket is closed.

Map file: `{{map_path}}`

## Phase 0: Load the conventions (mandatory)

1. Use the read tool to load `~/.pi/agent/skills/wayfinder/SKILL.md` in full
2. Use the read tool to load `~/.pi/agent/skills/issue-tracker.md` in full

## Phase 1: Check the map is actually done

Read `{{map_path}}`. The map is done when the frontier is empty **and** **Not yet specified** is empty.

If **Not yet specified** still holds fog, the map is not done. Say which patches remain, graduate any that the closed tickets have now made specifiable into fresh tickets, and stop. Do not hand off.

A softer signal fires first and it is the one to trust: when two or three tickets in a row resolve into "that is an implementation detail, whoever builds it can call it", you are done deciding. That remaining fog is implementation unknown, not decision, and it belongs in an issue's plan. Charting past that point pre-empts decisions the implementer should make with the code in front of them.

## Phase 2: Hand off

1. Invoke `to-prd`. It reads `MAP.md` and every closed ticket, so the decisions carry over without re-interviewing the user — the interviewing already happened, ticket by ticket.
2. Carry the map's **Out of scope** section straight into the PRD's own Out of scope section.
3. Then invoke `to-issues` as normal, and the effort leaves the map for `issues/`.

## Phase 3: Leave the map in place

Do not delete or archive the map or its tickets. They are the primary sources behind the PRD, and the PRD links back to them.
