# Global instructions

## Comments in code

Write code that reads without commentary. Names, types and small functions carry the explanation; a comment is the fallback for the rare thing they cannot express.

A comment earns its place only when it records something the reader cannot recover from the code itself:

- a constraint imposed from outside (protocol quirk, API limit, upstream bug being worked around)
- an invariant a future edit would silently break
- a deliberate choice that looks wrong until you know why

Everything else is noise: restating the line below, section banners, step-by-step narration, "// Set the flag", parameter lists already in the signature, and any reference to the task, ticket or agent that produced the code.

When a comment does earn its place, keep it to one line and write it about the code as it stands, not about the change you made.

The same applies to docstrings: one line describing intent, or none. Multi-paragraph prose belongs in the README, not above a function.

When editing existing code, leave comments already there alone unless they became wrong.
