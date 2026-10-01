# Writing the PRD from a wayfinder map

This PRD is the destination of a wayfinder map, and its decisions are on disk rather than in your context: they were resolved in sessions you never saw. Read `MAP.md` and the full body of every closed ticket before writing anything. Then:

- The map's **Destination** and **Decisions so far** are the raw material for Problem Statement, Solution, and Implementation Decisions
- The map's **Out of scope** carries into the PRD's Out of scope, near-verbatim
- Closed **`seam`** tickets have already settled their interfaces: carry each `## Resolution` shape into Implementation Decisions verbatim
- Closed `prototype` tickets carry their settled design or behaviour per the issue tracker's **Decisions prose cannot carry**: design transcripts linked under `## Assets` are cited as binding, and proved rules are written into the decision they support
- Research notes under `research/` get cited in Further Notes
