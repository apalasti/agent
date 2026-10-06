# Contract change requests

Requests from the frontend. None change `src/contract.ts` types; the frontend codes defensively either way.

## removeWorktree: keep the log on failure (frontend)

On success the output carries `log`. On failure the RPC rejects with only the error message, so the
teardown / `git gtr rm` output collected so far is lost. RemoveWorktreeDialog shows the rejection
message in a `<pre>`; please append the collected log to the thrown error's message
(e.g. `` `${message}\n\n${log.text()}` ``) so a failed teardown is debuggable from the dialog.
