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
