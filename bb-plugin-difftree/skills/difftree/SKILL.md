---
name: difftree
description: See a thread's git changes as a folder tree with +added -removed per folder and file with `bb difftree`. Use to get an overview of what a branch or worktree changed before reviewing, summarizing, or writing a PR description, or to find where most of a change lives.
---

# Diff tree

```sh
bb difftree                                   # this thread, remembered or default scope
bb difftree <thread-id>                       # another thread
bb difftree --uncommitted                     # staged, unstaged and untracked only
bb difftree --base origin/main                # merge-base with origin/main → working tree
bb difftree --base origin/main --committed    # merge-base with origin/main → HEAD (commits only)
bb difftree --depth 2                         # only two folder levels; deeper folders collapsed
bb difftree --json                            # the full file list as JSON, no line cap
```

Default scope: the scope the user picked in the Diff tree panel for this environment;
otherwise `--base origin/<default>` (or `<default>` without a remote) on a feature branch,
and `--uncommitted` on the default branch or a detached HEAD. Scope flags apply to this call
only; they do not change what the user picked.

## Output

```
rework/solution-page · All changes vs origin/main · 76 files +3133 -4256
frontend/                                            +2000 -1387
  src/                                               +1370 -1270
    components/                                       +752  -610
      solution-page/                                  +670  -206
        A DecksPanel.tsx                               +85    -0
        M useWhatIfComparison.ts                       +88   -18
…
migrations/versions/                                  +114    -0
  A 46c81a4657f2_history_day_indexes.py               +114    -0
? GLOSSARY.md                                          +13    -0
```

- Folders end in `/`; single-child chains are joined (`migrations/versions/`). Counts are summed.
- File letters: `A` added, `M` modified, `D` deleted, `R` renamed (`← old/path`), `C` copied,
  `T` type changed, `?` untracked. Binary files show `binary` instead of counts.
- Text output stops after 200 rows with `… N more rows`; use `--depth` or `--json` then.
- `bb capped the list at 500 files` means bb lists at most 500 files and the totals cover
  only those. Pick a closer base (`origin/main` rather than a stale local `main`).
- `No merge base with X` means the base branch does not exist in that checkout.

This shows counts, not patches. For a file's patch, use `git diff <merge-base> -- <path>` in
the workspace.
