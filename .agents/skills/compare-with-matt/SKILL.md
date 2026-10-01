---
name: compare-with-matt
description: Compare this setup against Matt Pocock's skills, take what's worth taking, and make every divergence from his earn its place.
disable-model-invocation: true
---

# Compare with Matt

Matt Pocock's skills, cloned at `mattpocock-skills/skills/` (ignored by this repo), are the **baseline**; this setup is a fork of them adapted to pi. A session takes the best of both: upstream gains worth having come in, and every **divergence** from Matt's version either carries a reason or goes back to his.

The **burden of proof** sits on the divergence. Matt's text is the default; ours stands only on one of these reasons:

- **Platform**: pi needs it. Name the pi fact.
- **Decision**: the user decided it, and [LEDGER.md](LEDGER.md) records it.
- **Lever**: ours is better by a named lever from `~/.pi/agent/skills/writing-for-agents/SKILL.md`, shown on the two passages side by side.

"Ours reads fine", "ours says more" and "we've always had it" are not reasons. Ledger entries are re-examined too: a decision whose reason no longer matches the code is a finding.

Read [LEDGER.md](LEDGER.md) first: it holds the counterpart map, every accepted divergence, and the upstream commit last compared.

## Steps

1. **Refresh the baseline.** `git -C mattpocock-skills/skills pull --ff-only`, then `git -C mattpocock-skills/skills log --stat --oneline <last compared>..HEAD -- skills/`. Done when you know which upstream files changed since the last session. With no **Last compared**, every file is new: skip the log.

2. **Scope and pair.** The user names what to compare, or it is everything. Pair each of our files with its counterpart from the ledger's map; a file the map doesn't place gets placed now, and the pairing goes into the list the user approves. Separately, list Matt's skills with no counterpart of ours and no entry under the ledger's **Not adopted**: these are **candidates**. Post the pair list and the candidates, and wait for the user's go. Done when every in-scope file of ours sits in exactly one pair or is marked ours-only.

3. **Dispatch reviewers.** In one message, spawn one `general-purpose` subagent per pair, plus one for all the candidates, each in the background. Each prompt holds: the path `.agents/skills/compare-with-matt/REVIEWER.md` to read and follow, the pair's paths on both sides, the ledger entries that touch the pair (verbatim), and the upstream commits from step 1 that touch it. Done when every reviewer has reported.

4. **Check the keeps.** Reviewers drift toward defending the file they were handed, so verify every finding they mark `keep ours`: re-read the two quoted passages yourself, and for a **Lever** reason confirm the lever applies to them. A reason that doesn't hold turns the finding into drift. Done when every `keep ours` is confirmed or reclassified.

5. **Report and stop.** One report, grouped by what the user must do:
   - **Take from Matt**: drift, and upstream gains worth having.
   - **Needs your call**: divergences with no reason found that look deliberate, ledger entries gone stale, candidates.
   - **Keep ours**: one line each, with its reason.

   Every item carries a recommendation and both quotes. Then stop and wait: edit nothing until the user approves items.

6. **Apply and record.** Make the approved changes. In the same change, update the ledger with only what the user approved: the pairings, each kept divergence with its reason, remove each one that went back to Matt's, each candidate the user turned down with their reason under **Not adopted**, and set **Last compared** to the upstream `HEAD` from step 1. Run `./setup.sh` if a skill or agent was added or removed.
