---
name: prototype
description: Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered, using the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md): a shareable demo a non-developer can drive.
- **"What should this look like?"** → [UI.md](UI.md): radically different variants behind a switcher.

The two branches produce very different artifacts, so getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious, but name it so a casual reader can see it's a prototype, not production.
2. **Trivial to run.** A UI prototype starts from one command in the project's task runner: `pnpm <name>`, `python <path>`, `bun <path>`, etc. A logic demo is a single HTML file the user double-clicks. Either way, no thinking required to start it.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE, wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
6. **Capture it when done.** A prototype is a **spec written in code**: it shows what to build, and none of its code is reused. Capture the answer (the verdict and the question it settled) in the issue, then capture the prototype itself as a **primary source**: commit it to a throwaway branch, out of main, and leave a context pointer to that branch on the implementation issue. Main gets none of it; the real code is built later from the written-down decision.

   **Then switch back to the branch you started on**, before anything else happens: the next branch is cut from wherever HEAD sits, so a checkout left on the prototype branch makes its throwaway commits ancestors of everything that ships. The prototype is consumed by pointer, never inherited as ancestry. Say out loud which branch you are on when you hand back.

7. **If the prototype settled a design, transcribe it.** A branch pointer is enough for a prototype that raised the fidelity of a discussion. It is not enough for one whose output is now the spec: downstream everybody reads prose, and prose cannot carry pixels, so an implementer ports the details the plan happens to cite and treats the rest as out of scope.

   So before you close, write a **design transcript** alongside the effort's other artifacts — `.scratch/<effort-slug>/design/<slug>.md` — and link it everywhere the branch is linked. For a UI prototype, the format and its completion test are step 6 of [UI.md](UI.md). Persist the screenshots there too rather than leaving them in `/tmp`.

   Downstream, the transcript is binding and the screenshots settle any disagreement. The implementer builds it in the codebase's own components and idiom, without opening the prototype's code. Writing it costs under an hour. Not writing it costs the same hour later, after the wrong thing has shipped.
