# Interface Design for Testability

## Deep modules

From "A Philosophy of Software Design": a **deep module** has a small interface over a lot of implementation. A **shallow module** has a large interface over little implementation; avoid it, since every method and parameter is one more thing to test and set up.

When designing an interface, ask:

- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?

## Return results rather than producing side effects

```typescript
// Testable
function calculateDiscount(cart): Discount {}

// Hard to test
function applyDiscount(cart): void {
  cart.total -= discount;
}
```

## Accept dependencies rather than creating them

At a system boundary, pass the dependency in so a test can substitute it: see [mocking.md](mocking.md).
