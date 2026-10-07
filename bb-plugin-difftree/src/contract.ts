import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const DIFF_CHANGED = "diff-changed";
export const diffChangedSchema = z.object({ environmentId: z.string() });
export type DiffChanged = z.infer<typeof diffChangedSchema>;

const branchName = z.string().trim().min(1).max(255);

export const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("uncommitted") }),
  /** merge-base(base, HEAD) to the working tree, untracked files included. */
  z.object({ kind: z.literal("all"), base: branchName }),
  /** merge-base(base, HEAD) to HEAD: committed changes only. */
  z.object({ kind: z.literal("committed"), base: branchName }),
]);
export type Scope = z.infer<typeof scopeSchema>;

export const changeKindSchema = z.enum(["added", "copied", "deleted", "modified", "renamed", "type_changed"]);
export type ChangeKind = z.infer<typeof changeKindSchema>;

export const changedFileSchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  changeKind: changeKindSchema,
  additions: z.number().int(),
  deletions: z.number().int(),
  binary: z.boolean(),
  untracked: z.boolean(),
  /** bb will not produce a patch for this file. */
  tooLarge: z.boolean(),
});
export type ChangedFile = z.infer<typeof changedFileSchema>;

export const totalsSchema = z.object({
  files: z.number().int(),
  additions: z.number().int(),
  deletions: z.number().int(),
});
export type Totals = z.infer<typeof totalsSchema>;

export const treeResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("available"),
    environmentId: z.string(),
    scope: scopeSchema,
    /** True when `scope` was chosen by defaultScope, not remembered. */
    scopeIsDefault: z.boolean(),
    currentBranch: z.string().nullable(),
    mergeBaseRef: z.string().nullable(),
    files: z.array(changedFileSchema),
    /** bb capped the list; `totals` then covers only `files`. */
    truncated: z.boolean(),
    totals: totalsSchema,
  }),
  z.object({
    outcome: z.enum(["no_environment", "not_applicable", "unavailable"]),
    environmentId: z.string().nullable(),
    scope: scopeSchema.nullable(),
    message: z.string(),
  }),
]);
export type TreeResult = z.infer<typeof treeResultSchema>;

const threadId = z.string().min(1);

export const treeInputSchema = z.object({
  threadId,
  /** Override for this call only; null uses the remembered or default scope. */
  scope: scopeSchema.nullable(),
});
export type TreeInput = z.infer<typeof treeInputSchema>;

export const patchInputSchema = z.object({ threadId, scope: scopeSchema, path: z.string().min(1) });
export type PatchInput = z.infer<typeof patchInputSchema>;

export const patchResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("available"), path: z.string(), patch: z.string(), truncated: z.boolean() }),
  z.object({ outcome: z.literal("unavailable"), path: z.string(), message: z.string() }),
]);
export type PatchResult = z.infer<typeof patchResultSchema>;

export const branchesInputSchema = z.object({ threadId, query: z.string().max(255).optional() });
export type BranchesInput = z.infer<typeof branchesInputSchema>;

export const branchesResultSchema = z.object({
  local: z.array(z.string()),
  remote: z.array(z.string()),
  truncated: z.boolean(),
});
export type BranchesResult = z.infer<typeof branchesResultSchema>;

export const setScopeInputSchema = z.object({
  threadId,
  /** null forgets the remembered scope and returns to the default. */
  scope: scopeSchema.nullable(),
});
export type SetScopeInput = z.infer<typeof setScopeInputSchema>;

export const rpcContract = defineRpcContract({
  tree: { input: treeInputSchema, output: treeResultSchema },
  patch: { input: patchInputSchema, output: patchResultSchema },
  branches: { input: branchesInputSchema, output: branchesResultSchema },
  /** Remembers the scope for the thread's environment and returns the tree under it. */
  set_scope: { input: setScopeInputSchema, output: treeResultSchema },
});
