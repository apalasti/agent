# The briefing

`briefing.md` is written for the human choosing the approach, who has not read the code. It answers "how does this work today, and what does that mean for the idea" in plain language. Evidence is kept, but moved out of the reader's way.

## Template

```markdown
# Briefing: <effort name>

## In short

<one paragraph, no code symbols: how the area works today, told as what happens, and the one
or two facts that most shape the idea>

## What matters for this idea

<!-- 3–7 findings, ranked by how much they constrain the approach. Each is a heading so
     premises can link to it; the body says the fact, then what it means for the idea. -->

### F1. <the fact as a plain sentence>

<two or three sentences: what it is, and what it forces or rules out>

## How it works today

<!-- follow one value end to end, from where it originates to where it is consumed. Short
     prose per step, or a table when the data lands in several places:
     | Where | What the user/system sees | Where its data comes from | -->

## Not yet confirmed

<!-- every inferred claim, gathered in one place, each with how to confirm it -->

## Evidence

| Finding | Where | Verified? |
|---|---|---|
| F1 | `path/to/file.py` `symbol` | yes / inferred |
```

## Rules

- Plain language above **Evidence**. A code symbol appears there only when the reader needs the name, e.g. a table or endpoint they will see again. Paths, verified/inferred marks and anchors live in **Evidence** only.
- No raw HTML. Findings are headings, so `briefing.md#f1-...` links work natively.
- Two screens at most. A fact that doesn't move the approach, and isn't needed to follow the walkthrough, stays out; the explore report holds it.
- When a later session corrects a finding, edit it in place and mark it `(corrected: <what was wrong>)`, since premises point at it.
