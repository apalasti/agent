# Coding standards

Read during review, not implementation. Each rule names what to look for and what to do instead.

## State

- **Derive, don't store.** A value computable from props, the URL or query data is computed at render. Keeping it in `useState` and setting it during render, or syncing it in an effect, is the violation.

## Shared code

- **One piece, not copies.** The same logic or idiom repeated across the change becomes one shared piece. A later change imitating an earlier change's workaround fixes the workaround instead of spreading it.

## Lint

- **Satisfy the rule, don't dodge it.** Code shaped to slip past a lint rule (a rename, an indirection, a split that exists only for the linter) is a violation even when the linter is green. Change the design so the rule passes as written.

## Comments

- **The code speaks; a comment is the fallback.** A comment earns its place only for an outside constraint, an invariant a later edit would silently break, or a choice that looks wrong until explained, in one line. Comments that narrate, restate the line below, or mention the plan, spec ids, issues or slices are violations.

## Tests

- **Test what the user can do and what data they see.** Tests of copy, labels, tooltips, or loading, empty and disabled states are violations.
- **One test per flow.** A test whose flow another test already walks is a violation; delete it.
