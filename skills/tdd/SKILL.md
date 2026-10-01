---
name: tdd
description: Test-driven development, red-green in vertical slices. Use when building features or fixing bugs test-first, or when the user wants integration tests.
---

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle: consult them before and during the loop, not after.

When exploring the codebase, read `GLOSSARY.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test is integration-style and reads like a specification: "user can checkout with valid cart" tells you exactly what capability exists, and it survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for where mocks belong.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at agreed seams.** The plan or PRD names the seams under test; where neither does, write them down and confirm them with the user before the first test. Agreeing the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

When the shape of that interface is itself in question (how deep the module is, where the seam belongs, what the interface should expose), invoke the `codebase-design` skill for the vocabulary. It is a reference to consult, not a session to run.

## Every test must be able to fail

Pointing at the public interface is not enough; a test that can never redden passes that bar comfortably. The second bar decides whether a test is worth its lines:

**A test must carry an assertion able to contradict the code.** Name the change to production code that would make it fail. If you cannot name one, the test has no value — delete it rather than keeping it for the coverage.

The genres that pass the first bar and fail this one, all through public interfaces, all surviving any refactor:

- **Tautologies** — the expected value is recomputed the way the code computes it (`expect(add(a, b)).toBe(a + b)`), so it passes by construction. Expected values come from an independent source of truth: a known-good literal, a worked example, the spec.
- **Fixture echoes** — asserting a value lands somewhere unchanged. It cannot fail while the code is self-consistent.
- **Round trips through a matched pair** — mint then parse, serialise then deserialise. Catches only self-inconsistency. Assert against a hand-written literal instead.
- **Subsumed tests** — every assertion already made by another test. It reddens only when that one does.
- **Framework guarantees** dressed as product behaviour — that the dropdown closes on outside click is the library's test, not yours.
- **Assertions that match nothing** — a regex no component renders, a negative assertion about something the fixture never contained. Vacuously green forever.

Two habits that keep this honest:

- **Build the fixture hostile to the assertion.** A test claiming an ordering builds its input in the wrong order; one claiming something is filtered out puts it in. A pre-sorted fixture leaves the production sort unpinned, and a comparison blind to ordering (a dict `==`, an unordered contains) pins nothing at all.
- **Check subsumption before adding a tier.** A page-level test that re-proves what the component test already proved buys nothing and costs a second thing to maintain. Test each decision at the tier that owns it.

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Horizontal slicing**: writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead: one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage (see the `code-review` skill), not the red → green implementation cycle.

## Checklist per cycle

```
[ ] Test goes through an agreed seam only
[ ] You can name the production change that would make it fail
[ ] Code is minimal for this test
```
