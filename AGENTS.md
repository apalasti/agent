# Global instructions

## Comments in code

Write code that reads without commentary. Names, types and small functions carry the explanation; a comment is the fallback for the rare thing they cannot express.

A comment earns its place only when a reader would be actively **wrong** without it — not merely when the code does not spell something out. Silence is acceptable; misinformation is not. "The code doesn't say this" is true of almost every sentence you could write, so it is not a test. Ask instead what false belief the reader arrives at unaided, and write only that:

- a constraint imposed from outside (protocol quirk, API limit, upstream bug being worked around)
- an invariant a future edit would silently break
- a deliberate choice that looks wrong until you know why

Everything else is noise: restating the line below, section banners, step-by-step narration, "// Set the flag", parameter lists already in the signature, and any reference to the task, ticket or agent that produced the code.

When a comment does earn its place, keep it to one line and write it about the code as it stands, not about the change you made.

A comment claiming a dependency or an invariant is a claim, so check it before you keep it: remove the thing it says is load-bearing and confirm something actually breaks. A claim of necessity nobody verified is worse than silence — it misinforms the next reader and pins dead code in place on its own authority.

The same applies to docstrings: one line describing intent, or none. Multi-paragraph prose belongs in the README, not above a function.

When editing existing code, leave comments already there alone unless they became wrong.

## Restructures are designed in text before they are built

A ground-up restructure — moving state between providers, redrawing a component hierarchy, changing what lives where — is written down and agreed before any of it is built. Not a paragraph of intent: a **per-file contents outline** (each file, its exports, its types, its signatures) and, when state or identity moves, an **end-to-end trace** of how one value travels from where it originates to where it is consumed. A proposal without those two things is not reviewable, whatever it says.

This is not about getting it right the first time. Taste about structure usually forms only against real code, and changing your mind after seeing it is a legitimate way to work. The point is to make the change of mind cheap: reversing a design that exists as a page of text costs an edit, reversing one that exists only as a rebuilt tree costs the rebuild again. So the design lands as text, and the implementation is a separate pass against it.

The same bar applies to *reading* one: an outline that leaves a reader unable to say where a value comes from has not been written down, only alluded to.

## Debugging

- **Instrument before fixing.** If the failure has not been reproduced and observed, do not land a fix for it. A speculative fix with a green test of its own proves nothing about the reported symptom, and two of them in a row cost more than the logging would have. Add the tracing that shows what actually runs, in what order, and read it.
- **A fix is done when the reported symptom is confirmed gone in the running system** — not when its own test passes. The test pins what you believed; the symptom is what was wrong.
- **Never close a report as unreproducible against synthetic data.** A payload built to mirror the shape will miss anything that only real data exhibits. Reproduce with the reporter's actual data, or say plainly that you could not and what you tried.

## When a decision is reversed, update the artifact that recorded it

Decisions get written down — in a PRD, a map, an issue, an ADR — and then reversed later with the code in front of you. That is normal and usually right. What is not acceptable is leaving the artifact carrying the superseded decision as though it still stood.

So the reversal and the write-back are one change, not two. Update the text where it was recorded, and leave one line saying what it replaced, so a reader can tell the decision was revisited rather than never made. The next agent reads these artifacts cold and inherits whatever they say; an artifact that contradicts the code is worse than no artifact, because it will be believed.
