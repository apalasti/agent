export const meta = {
  name: 'migrate-bb-plugins-to-pi',
  description: 'Thread namer → pi CLI; subagents plugin → pi subagents + workflows (backend, UI), then review',
  phases: [
    { title: 'Build', detail: 'thread namer in parallel with subagents backend → UI' },
    { title: 'Review', detail: 'check the branch against the design, fix findings' },
  ],
}

const WT = '/Users/andraspalasti/fun/agent-pi-subagents'
const DESIGN = '/Users/andraspalasti/fun/agent/.scratch/pi-subagents/design.md'
const SUB = `${WT}/bb/bb-plugin-pi-subagents`
const NAMER = `${WT}/bb/bb-plugin-thread-namer`
const gateFor = dir => `cd ${dir} && npm run typecheck && npm test`

const COMMON = `Work ONLY inside the git worktree ${WT} (branch pi-subagents; node_modules already installed). Never touch /Users/andraspalasti/fun/agent itself except to read.
The agreed design is ${DESIGN} — read it fully first and follow it; where reality forces a deviation, update the design doc's relevant line and say what it replaced.
Follow ${WT}/AGENTS.md (comment rules especially). Match the surrounding code style. Use TDD where practical. Commit your work in the worktree with a clear message when the gate passes.
Your final text is a short report: what you built, deviations, anything unverified.`

phase('Build')
const [namer, ui] = await parallel([
  () => agent(`${COMMON}

Task: section "B. bb-plugin-thread-namer" of the design, in ${NAMER}. Replace the claude CLI with the pi CLI. Verified facts: \`pi -p --no-session --no-tools --no-skills --no-context-files --no-prompt-templates --no-themes --no-mcp --offline --model claude-bridge/claude-haiku-5-5 --system-prompt "..."\` with the prompt on stdin prints only the reply (2.5s with all extensions). pi lives at ~/.pi/agent/bin/pi. Default extensions setting is empty = load all. Update README, package.json description, tests. Finally run one real completion through complete() (e.g. a tiny tsx/vitest script or node) to prove it works end to end, and report the output and time.`,
    { label: 'thread-namer', phase: 'Build', gate: gateFor(NAMER) }),
  async () => {
    const backend = await agent(`${COMMON}

Task: the BACKEND of section "A" in ${SUB} (already git-mv'd from bb-plugin-claude-subagents): package.json/app.tsx ids and names, src/contract.ts, src/events.ts, NEW src/piSession.ts, src/parent.ts, src/workflow.ts, rewritten src/assemble.ts and src/sessions.ts, server.ts; delete src/transcript.ts. Leave src/ui mostly alone except the minimum to keep typecheck green (a UI agent rewrites it after you) — but DO update src/ui/format.ts per the design (shortModel "Sonnet 5.5", kTokens "162.3k", duration "8m 31s") with tests.
Tests: replace the Claude fixtures with small trimmed REAL pi files from this machine: parent session ~/.bb/pi-bridge-sessions/pi_e6c62b6b-9ba7-4f95-85af-6183a2877e86.jsonl (has Agent spawns, subagents:record, subagent-notification, a SubagentWorkflow launch for wf_98928077532b), child sessions in ~/.pi/agent/sessions/--Users-andraspalasti-fun-agent--/ (headers with parentSession pointing at that file; names like Explore#ff796ad3), and task dir /var/folders/hb/z0645d0501q_35ylknn4gl3c0000gn/T/pi-subagents-501/Users-andraspalasti-fun-agent/01a11d12-e481-771f-b48d-2541fad34b6a/tasks/ (.output, .workflow.js, .workflow.jsonl). Trim long text, keep structure. Note: the session store must take its roots as parameters so tests use a temp dir.
Before finishing, run the real store + assemble against that real parent session (a throwaway script outside the repo or a skipped-by-default test) and report: agents found with status/model/tokens/tool uses, and the workflow with its children count. The workflow wf_98928077532b should have 7 children.`,
      { label: 'subagents-backend', phase: 'Build', gate: gateFor(SUB) })
    if (backend === null) return null
    return agent(`${COMMON}

Task: the UI of section "A" in ${SUB}. The backend is done and committed (its report: ${backend}).
Build the card list, AgentCard, WorkflowCard, WorkflowView, TranscriptView (PromptCard with clamp/fade/Show more/copy, ActivitySummary, report through the host \`Markdown\` component exported from "@get-bb/plugin-sdk/app" — see node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts for MarkdownProps), src/ui/activity.ts, HeaderPill updates; delete AgentRow/AgentDetail/ContextBar. Visual reference: the agent card is a rounded muted card with three lines: "Notebook for L6.01" / "Agent  Completed  8m 31s" / "Sonnet 5.5  162.3k tokens  44 tool uses  View transcript" (link-colored). Transcript view: "< title" header, "Model Sonnet 5.5", prompt card with Show more and a copy icon under it, a muted collapsed line "Ran 41 commands (4 failed), read L6-multi-node-chains.md, used a tool >", then the markdown report.
Rewrite test/panel.test.tsx (and add activity tests) to cover: card text, View transcript navigation and back, workflow card → workflow view → transcript → back to workflow view, Steer…/Follow up… inserting text with the agent id into a fake composer, no actions on workflow children, empty state. Update README.md and DESIGN.md (rewrite for pi; one line saying it replaced the Claude Code design). Finally run \`bb plugin build .\` in ${SUB} and report whether it succeeds (do NOT install).`,
      { label: 'subagents-ui', phase: 'Build', gate: gateFor(SUB) })
  },
])

phase('Review')
const review = await agent(`${COMMON}

Task: review the whole branch (\`git -C ${WT} diff main...HEAD\`, plus uncommitted) against the design doc and AGENTS.md. Build reports: thread-namer: ${namer ?? 'FAILED'}; subagents UI: ${ui ?? 'FAILED'}.
Look for: design mismatches, bugs in the status/attribution logic, broken parsing of real pi files, leftover Claude-specific code or wording, comments that violate AGENTS.md, missing tests. Fix what you find (small, targeted), keep both gates green, commit. Report: findings, what you fixed, what you left and why.`,
  { label: 'review', phase: 'Review', gate: `${gateFor(SUB)} && ${gateFor(NAMER)}` })

return { namer, ui, review }
