# Contract changes

`src/contract.ts` is owned by the lead. Builders may only add to it (new fields, schemas or methods) and log each addition here, one line: date, who, what, why.

- 2026-10-07, backend: `branchesResultSchema.message` (optional string) — branches has no outcome field, so a failed listing (no environment, bb error) returns empty lists plus this message instead of an RPC error.
