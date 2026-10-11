# Plugin UI style

One visual language for every bb plugin in this repo, taken from bb's own components and builtin plugins.
Shared primitives live once in `bb/kit/src/`; `bb/kit/sync.sh` copies them into each plugin's `src/kit/`
(each plugin builds alone, so it carries its own copy). Edit `bb/kit/src/`, never a plugin's `src/kit/`, then
run the sync.

The look follows Claude Code's own panels: filled borderless cards for the things you track, plain words for
details, strong colours for the context breakdown. The reference pictures are `bb/style-reference/*.png`.
Replaces the flush variant (A) picked from the `prototype/plugin-style` prototype (commit `e5a2f84`); the
token, status, state and dialog rules below carried over unchanged.

## 1. Tokens only
- Colors come from host tokens. No palette classes (`amber-500`, `slate-500`…), no `oklch()`, no hex.
- Text tones, strongest to weakest: `text-foreground` → `text-muted-foreground` (secondary text) →
  `text-subtle-foreground` (counts, metadata, hints). Never fade text with opacity (`/70`, `opacity-80`).
- Semantic text: `text-success-foreground` (not `text-success`, which is too light for text),
  `text-warning-text`, `text-destructive-text`, `text-diff-added` / `text-diff-removed` (line counts only).
  Links use `LinkButton` (`text-file-accent`); the vendored `variant=link` alone renders near-black.
- Washes: `hover:bg-state-hover`, pressed/open `bg-state-active`, selected `bg-surface-selected`,
  wells `bg-surface-recessed`, error `bg-surface-destructive border-surface-destructive-border`,
  warning `bg-surface-attention` (bb has no attention border token; use `border-transparent`).

## 2. Type scale (bb's, no arbitrary sizes)
| Step | px | Use |
|---|---|---|
| `text-sm` | 13 | row titles, body, inputs, panel state messages |
| `text-xs` | 12 | metadata, menus, notes, row buttons |
| `text-2xs` | 10 | section labels and tags only |
- No `text-[10px]`, `text-[11px]`, `text-[13px]`: 13px is `text-sm`; 11px metadata becomes `text-xs`
  `text-subtle-foreground`; 11px labels/tags become `text-2xs`.
- Inside cards the title is `text-sm`, details `text-xs text-muted-foreground` (the reference pictures' larger
  card and label text was tried and dropped as too big).
- Weights: `font-medium` titles, `font-semibold` section labels. No hero numbers, no `font-bold`.
- Sentence case everywhere. No `uppercase`, no `tracking-*`.
- `font-mono text-xs` for ids, paths, branches, tool calls, shortcuts. `tabular-nums` on every number.
  Minus is U+2212.

## 3. Panel skeleton
- The host title bar names the panel; a panel never repeats its title.
- Gutter `px-3` everywhere.
- Optional toolbar: `PanelToolbar` (`h-10 border-b border-border-hairline px-2`) with `ToolbarButton`s
  (ghost `size-7`, icon `size-3.5`; pressed is the vendored `aria-pressed` style, never a `bg-accent` override).
- Body: `PanelBody`. Things you track (agents, workflows, task batches, hand-offs) are `Card`s in a
  `CardStack` (§3a). Plain lists and breakdowns are `Group`s: a `border-t border-border-hairline` section with
  an optional `SectionLabel`, or a `DisclosureHeader` when the section collapses.
- Exceptions that stay lists: difftree's file tree (cards waste width and break its keyboard navigation) and
  the worktrees sidebar (§5).
- Optional footer: `PanelFooter` (`border-t border-border-hairline px-3 py-2`).
- Sub-view (subagents transcript/workflow): `SubViewHeader` with a back button and `text-sm font-medium` title.

## 3a. Cards (`bb/style-reference/workflow-card.png`)
- `CardStack`: `flex flex-col gap-2 p-3`. `Card`: `<article aria-label>`, `rounded-xl bg-muted/40 px-4 py-3
  text-xs`, no border, no shadow. Cards never nest.
- `CardHeader`: title (`text-foreground`, truncates) with the duration or count on the right.
- Then `Words` lines: details as plain words with `gap-x-3` between them ("Workflow  Completed",
  "14 agents  1.2M tokens"). No `·`, no leading status icon; the status is a word, toned per §6.
- Then an optional `CardText` description in `text-muted-foreground`, wrapping.
- Then optional `CardSection`s ("Phases", "Agents"): a `SectionLabel` and its rows. A phase row is name,
  `5/5`, chevron, with `Ticks` under it: one `size-2 rounded-sm` square per agent, coloured by its status dot.
- A card that opens a sub-view has a `RowOpen` title (its hit area covers the card) and `interactive`.

## 4. Section label
`SectionLabel`: `px-3 pb-1 pt-3 text-2xs font-semibold text-muted-foreground`, sentence case, optional
right-aligned `text-2xs tabular-nums text-subtle-foreground` aside. `inset={false}` inside a card. `CollapsibleLabel` is the same with a leading
chevron; `DisclosureHeader` is a section title with its aside and a trailing chevron ("Context window
197.1k / 1M (20%) ⌄").

## 5. Rows
- `Row`: `h-7 px-3 text-sm hover:bg-state-hover`, instant hover. Leading glyph `size-3.5` or a `size-1.5` dot;
  title `min-w-0 flex-1 truncate`; trailing meta `text-xs tabular-nums text-subtle-foreground`.
- `TwoLineRow`: second line `text-xs text-muted-foreground`. Details on any line are `Words`, never `·`.
- Row actions replace the trailing meta on hover/focus (always visible on coarse pointers): `RowIconButton`
  (ghost `size-6.5`), `RowMoreMenu` (`MoreHorizontal`), `RowButton` (outline `h-6.5 text-xs`; the vendored
  `size=sm` is 32px and does not fit a 28px row).
- No dividers between rows; groups are separated by `border-t border-border-hairline`.
- Exception: the worktrees sidebar keeps bb's sidebar row style (inset `rounded-md` rows, `px-2`,
  `hover:bg-sidebar-accent`, `--bb-sidebar-row-height`), because it replaces bb's own list and must match it.

## 6. Status vocabulary (one map, every plugin: `STATUS` in the kit)
| State | Glyph | Text tone | Dot |
|---|---|---|---|
| running | `Loading` spin | `text-muted-foreground` | `bg-file-accent` |
| ready | `Circle` | `text-success-foreground` | `bg-success` |
| done | `CircleCheck` | `text-muted-foreground` | `bg-subtle-foreground` |
| warning (needs a look, dirty, no report) | `AlertTriangle` | `text-warning-text` | `bg-warning` |
| failed | `CircleX` | `text-destructive-text` | `bg-destructive` |
| idle (blocked, unknown) | `CircleQuestion` | `text-subtle-foreground` | hollow `border border-subtle-foreground` |
- Dots are `size-1.5 rounded-full`. Finished work recedes (done is muted); actionable work (ready) is green.
- Spinners always carry `motion-reduce:animate-none`; nothing pulses.

## 7. Small parts
- `Spinner`: `Loading` `size-3.5 animate-spin`, one component.
- `Tag`: `rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground`
  (counts, blocker chips, ticket types, "claimed").
- `HeaderPill`: ghost `Button size=sm` `h-7 gap-1.5 px-2 text-xs tabular-nums`, icon `size-3.5`. Used for the
  subagents pill and the tasks button. The context ring keeps its rounded-full composer shape because it
  stands in for bb's native ring.
- `Meter`: `role="progressbar"`, `h-1.5` track, also for the context total (no hero gauge; the context
  panel opens with a `DisclosureHeader` "Context window  197.1k / 1M (20%)" over a thin Meter).
- `CodeWell`: `rounded-md bg-surface-recessed px-2.5 py-2 font-mono text-xs leading-relaxed`.
- Buttons are always the vendored `Button` (or a kit wrapper of it). No hand-rolled `<button class=…>` chrome.
- Hover hints use `Hint` (a tooltip), not `title` on buttons; disabled controls get their reason in a `Hint`.
- Context breakdown (`bb/style-reference/context.png`): a thin `Meter` across the top; then one row per
  category: `Swatch` (`size-3 rounded-sm`), name in `text-sm text-foreground`, tokens right-aligned in
  `text-xs text-muted-foreground`, share right-aligned in `text-xs text-foreground` (`—` when it has no share). No lines
  between rows. Groups that fold ("MCP tools") use a leading chevron and show an item count instead of a share.
- Context fills: the big categories get strong, distinct theme colours (`bg-file-accent`, `bg-warning`,
  `bg-success`, `bg-attention`, `bg-pr-merged`); system-type categories are greys (`bg-foreground/45`), the
  buffer is `bg-foreground/20`, free space `bg-muted`. Host tokens only, so light and dark both work. Every
  category the user can tell apart today stays distinguishable (tool definitions ≠ tool results). Nothing
  that is not an error uses a red (`bg-diff-removed`, `bg-destructive`).

## 8. States
- `PanelState` (loading / empty / unavailable / error), centred:
  `flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground`. Loading leads with
  the Spinner; error text is `text-destructive-text` with an outline `size=sm` Retry; unavailable has a
  `font-medium text-foreground` title.
- `InlineNote` inside a list or popover: `px-3 py-2 text-xs text-muted-foreground`.
- `Callout tone="error"` for an error with stale data kept (with `LinkButton` Retry); `Callout tone="warning"`
  for warnings, leading `AlertTriangle`.
- The worktrees sidebar keeps sidebar density: `px-2 py-1.5 text-xs` notes, no centring.

## 9. Dialogs, menus, settings
- Vendored Dialog, AlertDialog, Command and menus are used as bb ships them, even where their chrome breaks
  §2 (`text-base tracking-tight` titles, faded close buttons). Re-vendor, don't edit.
- Widths `sm:max-w-md` (confirm), `sm:max-w-2xl` (settings), `sm:max-w-3xl` (composer dialogs).
  Footer: ghost Cancel + default/destructive `size=sm`.
- Fields: Label `text-xs font-medium`, Input `h-8 text-sm` (`font-mono` for refs, paths, commands),
  hint `text-xs text-subtle-foreground`, error `text-xs text-destructive-text`.
- Menus: vendored only (`RowMenu` in the kit); icons on every item or none within one menu.
