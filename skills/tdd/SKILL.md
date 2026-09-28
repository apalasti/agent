---
name: tdd
description: Test-driven development, red-green-refactor in vertical slices. Use when building features or fixing bugs test-first, or when the user wants integration tests.
---

# Test-Driven Development

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test is integration-style and reads like a specification ("user can checkout with valid cart"); a test that breaks when you refactor without changing behavior was testing implementation. See [tests.md](tests.md) for good and bad examples, and [mocking.md](mocking.md) for where mocks belong.

## Every test must be able to fail

Pointing at the public interface is not enough; a test that can never redden passes that bar comfortably. The second bar decides whether a test is worth its lines:

**A test must carry an assertion able to contradict the code.** Name the change to production code that would make it fail. If you cannot name one, the test has no value — delete it rather than keeping it for the coverage.

The genres that pass the first bar and fail this one, all through public interfaces, all surviving any refactor:

- **Fixture echoes** — asserting a value lands somewhere unchanged. It cannot fail while the code is self-consistent.
- **Round trips through a matched pair** — mint then parse, serialise then deserialise. Catches only self-inconsistency. Assert against a hand-written literal instead.
- **Subsumed tests** — every assertion already made by another test. It reddens only when that one does.
- **Framework guarantees** dressed as product behaviour — that the dropdown closes on outside click is the library's test, not yours.
- **Assertions that match nothing** — a regex no component renders, a negative assertion about something the fixture never contained. Vacuously green forever.

Two habits that keep this honest:

- **Build the fixture hostile to the assertion.** A test claiming an ordering builds its input in the wrong order; one claiming something is filtered out puts it in. A pre-sorted fixture leaves the production sort unpinned, and a comparison blind to ordering (a dict `==`, an unordered contains) pins nothing at all.
- **Check subsumption before adding a tier.** A page-level test that re-proves what the component test already proved buys nothing and costs a second thing to maintain. Test each decision at the tier that owns it.

## Work in vertical slices

One test → one implementation → repeat, as tracer bullets. Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behavior matters and how to verify it.

The opposite is **horizontal slicing**: all tests first, then all implementation, treating RED as "write all tests" and GREEN as "write all code". It produces **crap tests**:

- Tests written in bulk test _imagined_ behavior, not _actual_ behavior
- You end up testing the _shape_ of things (data structures, function signatures) rather than user-facing behavior
- Tests become insensitive to real changes - they pass when behavior breaks, fail when behavior is fine
- You outrun your headlights, committing to test structure before understanding the implementation

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

## Workflow

### 1. Planning

When exploring the codebase, use the project's domain glossary so that test names and interface vocabulary match the project's language, and respect ADRs in the area you're touching.

Before writing any code:

- [ ] Confirm with user what interface changes are needed
- [ ] Confirm with user which behaviors to test: you can't test everything, so prioritize critical paths and complex logic over every possible edge case
- [ ] Design interfaces for testability, with deep modules: see [interface-design.md](interface-design.md)
- [ ] List the behaviors to test (not implementation steps)
- [ ] Get user approval on the plan

Ask: "What should the public interface look like? Which behaviors are most important to test?"

### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior → test fails
GREEN: Write minimal code to pass → test passes
```

This is your tracer bullet - proves the path works end-to-end.

### 3. Incremental Loop

For each remaining behavior:

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

Rules:

- One test at a time
- Only enough code to pass current test
- Keep tests focused on observable behavior

### 4. Refactor

Refactor only at GREEN. After all tests pass, look for:

- [ ] Duplication → extract a function or class
- [ ] Shallow modules → combine or deepen (move complexity behind simple interfaces)
- [ ] Long methods → break into private helpers, keeping tests on the public interface
- [ ] Feature envy → move logic to where its data lives
- [ ] Primitive obsession → introduce value objects
- [ ] Existing code the new code reveals as problematic
- [ ] Run tests after each refactor step

## Checklist Per Cycle

```
[ ] Test goes through the public interface only
[ ] You can name the production change that would make it fail
[ ] Code is minimal for this test
```
