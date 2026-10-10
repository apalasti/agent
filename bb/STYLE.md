# Plugin UI style

One visual language for every bb plugin in this repo, taken from bb's own components and builtin plugins.
Shared primitives live once in `bb/kit/src/`; `bb/kit/sync.sh` copies them into each plugin's `src/kit/`
(each plugin builds alone, so it carries its own copy). Edit `bb/kit/src/`, never a plugin's `src/kit/`, then
run the sync.

Settled by a prototype that rendered every surface of context, difftree, pi-subagents and worktrees in two
variants; the flush variant (A) won over cards (B). Prototype and screenshots: branch `prototype/plugin-style`,
`bb/bb-plugin-style-prototype/` (`screenshots/a-*.png` are the reference).

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
| `text-2xl font-semibold` | 24 | one hero number per panel (context total) |
| `text-sm` | 13 | row titles, body, inputs, panel state messages |
| `text-xs` | 12 | metadata, menus, notes, row buttons |
| `text-2xs` | 10 | section labels and tags only |
- No `text-[10px]`, `text-[11px]`, `text-[13px]`: 13px is `text-sm`; 11px metadata becomes `text-xs`
  `text-subtle-foreground`; 11px labels/tags become `text-2xs`.
- Weights: `font-medium` titles, `font-semibold` section labels and the hero number. No `font-bold`.
- Sentence case everywhere. No `uppercase`, no `tracking-*`.
- `font-mono text-xs` for ids, paths, branches, tool calls, shortcuts. `tabular-nums` on every number.
  Minus is U+2212.

## 3. Panel skeleton (flush thread panels)
- The host title bar names the panel; a panel never repeats its title.
- Gutter `px-3` everywhere.
- Optional toolbar: `PanelToolbar` (`h-10 border-b border-border-hairline px-2`) with `ToolbarButton`s
  (ghost `size-7`, icon `size-3.5`; pressed is the vendored `aria-pressed` style, never a `bg-accent` override).
- Body: `PanelBody`, edge to edge. Groups are `Group`: a `border-t border-border-hairline` section with an
  optional `SectionLabel`. No cards inside panels.
- Optional footer: `PanelFooter` (`border-t border-border-hairline px-3 py-2`).
- Sub-view (subagents transcript/workflow): `SubViewHeader` with a back button and `text-sm font-medium` title.

## 4. Section label
`SectionLabel`: `px-3 pb-1 pt-3 text-2xs font-semibold text-muted-foreground`, sentence case, optional
right-aligned `tabular-nums text-subtle-foreground` aside.

## 5. Rows
- `Row`: `h-7 px-3 text-sm hover:bg-state-hover`, instant hover. Leading glyph `size-3.5` or a `size-1.5` dot;
  title `min-w-0 flex-1 truncate`; trailing meta `text-xs tabular-nums text-subtle-foreground`.
- `TwoLineRow`: second line `text-xs text-muted-foreground`.
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
- `Meter`: `role="progressbar"`, `h-1.5` track; `size="lg"` (`h-3`) for the single hero gauge (context total).
- `CodeWell`: `rounded-md bg-surface-recessed px-2.5 py-2 font-mono text-xs leading-relaxed`.
- Buttons are always the vendored `Button` (or a kit wrapper of it). No hand-rolled `<button class=…>` chrome.
- Hover hints use `Hint` (a tooltip), not `title` on buttons; disabled controls get their reason in a `Hint`.
- Context category fills come from host tokens only (`bg-file-accent`, `bg-success`, `bg-warning`,
  `bg-attention`, `bg-pr-merged`, `bg-foreground/70`, `/45`, `/25`; `bg-muted` for free space). Every
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
