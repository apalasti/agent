# Contract changes

Append-only log. Each entry: date, who (backend/frontend), what was added to `src/contract.ts`, and why.

- 2026-10-07, backend: `turnSchema.notEditableReason` (optional nullable string). bb only lets
  `threads.editMessage` edit requests with `initiator: "user"`, no `senderThreadId`, and a
  `new-turn`/`thread-start` target ("The selected request is not an editable user turn"
  otherwise), so messages sent by agents or other threads are not editable even when the
  thread is idle. The field says which reason applies: "Sent by another thread or an agent"
  or "The thread is running".
