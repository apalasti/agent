---
name: grill-me
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

✅ **<title>**: <the answer the facts decide>. Evidence: <what you checked>. Say so to overrule.
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. Before asking a question, name what it takes for granted: how things behave today, what already exists, what something would cost. Each of those you have not checked in the environment is an unsettled prerequisite: dispatch a sub-agent to check it, and hold the question until it reports. A question built on an unchecked assumption is not a decision; it is your guess handed to the user to own. Questions whose prerequisites are all settled go out now, without waiting.

When the facts alone decide the answer, state it with its evidence and let the user veto it. Ask only where it is genuinely a preference or a trade-off the facts leave open, and then give the user the facts they need to choose. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Present the settled tree, and act on it only once the user confirms it.
