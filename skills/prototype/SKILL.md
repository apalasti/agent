---
name: prototype
description: Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered, using the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md). Build a single shareable HTML file (free-play buttons plus tabbed guided walkthroughs) that pushes the state machine through cases that are hard to reason about on paper, and that a non-developer can drive.
- **"What should this look like?"** → [UI.md](UI.md). Generate several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.

The two branches produce very different artifacts, so getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious, but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes, obey whatever routing convention the project already uses; don't invent a new top-level structure.
2. **Trivial to run.** A UI prototype starts from one command in the project's task runner: `pnpm <name>`, `python <path>`, `bun <path>`, etc. A logic demo is a single HTML file the user double-clicks. Either way, no thinking required to start it.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE, wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
6. **Capture it when done.** Fold any validated decision into the real code, then capture the prototype itself as a **primary source**: commit it to a throwaway branch, out of main, and leave a context pointer to that branch on the implementation issue. Capture the answer too (the verdict and the question it settled) in the issue or a commit. The main branch keeps only the validated decision.

   **Then switch back to the branch you started on**, before anything else happens. Leaving the checkout on the prototype branch is how prototype commits end up as the base of the implementation branch: the next person cuts a branch from wherever they are standing, and four throwaway commits are now ancestors of everything that ships, bound for main. The implementation branch is cut from the **base** branch — the prototype is consumed by pointer, never inherited as ancestry. Say out loud which branch you are on when you hand back.

7. **If the prototype settled a design, transcribe it.** A branch pointer is enough for a prototype that raised the fidelity of a discussion. It is not enough for one whose output is now the spec. Downstream everybody reads prose, and prose cannot carry pixels: an implementer ports the details the plan happens to cite and treats the rest as out of scope, so "none of its code ships" gets read as "none of its classes matter".

   So before you close, write a **design transcript** alongside the effort's other artifacts — `.scratch/<effort-slug>/design/<slug>.md` — and link it everywhere the branch is linked. Element by element: the prototype file that holds it, and the markup shape, classes and copy it settles. Persist the screenshots there too rather than leaving them in `/tmp`.

   Downstream, the transcript is the spec, verbatim; the branch is just where its code happens to live. Writing it costs under an hour. Not writing it costs the same hour later, after the wrong thing has shipped.