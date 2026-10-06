import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const TASK_WORKTREE_PROVIDER_ID = "task-worktree";
export const WORKTREES_CHANGED = "worktrees-changed";

export const worktreeSchema = z.object({
  path: z.string(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  isMain: z.boolean(),
  isDetached: z.boolean(),
  isLocked: z.boolean(),
  isPrunable: z.boolean(),
  environmentIds: z.array(z.string()),
});
export type Worktree = z.infer<typeof worktreeSchema>;

export const worktreeStatusSchema = z.object({
  path: z.string(),
  dirtyFiles: z.number().int(),
  upstream: z.string().nullable(),
  ahead: z.number().int(),
  behind: z.number().int(),
});
export type WorktreeStatus = z.infer<typeof worktreeStatusSchema>;

export const projectConfigSchema = z.object({
  baseRef: z.string().trim().min(1).nullable(),
  overlayDir: z.string().trim().min(1).nullable(),
  setupCommand: z.string().trim().min(1).nullable(),
  teardownCommand: z.string().trim().min(1).nullable(),
  tool: z.enum(["auto", "gtr", "git"]),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export const resolvedConfigSchema = projectConfigSchema.extend({
  effectiveBaseRef: z.string(),
  effectiveOverlayDir: z.string().nullable(),
  effectiveTool: z.enum(["gtr", "git"]),
});
export type ResolvedConfig = z.infer<typeof resolvedConfigSchema>;

export const taskWorktreeInputsSchema = z.object({
  branch: z.string().trim().min(1).optional(),
  from: z.string().trim().min(1).optional(),
});
export type TaskWorktreeInputs = z.infer<typeof taskWorktreeInputsSchema>;

const projectRef = z.object({ projectId: z.string().min(1) });

export const rpcContract = defineRpcContract({
  listWorktrees: {
    input: projectRef,
    output: z.object({
      projectId: z.string(),
      sourcePath: z.string(),
      worktrees: z.array(worktreeSchema),
    }),
  },
  worktreeStatus: {
    input: projectRef.extend({ path: z.string().min(1) }),
    output: worktreeStatusSchema,
  },
  branches: {
    input: projectRef.extend({ query: z.string().default(""), limit: z.number().int().max(200).default(50) }),
    output: z.object({ branches: z.array(z.string()) }),
  },
  validateBranch: {
    input: projectRef.extend({ branch: z.string() }),
    output: z.object({
      ok: z.boolean(),
      message: z.string().nullable(),
      existingWorktreePath: z.string().nullable(),
    }),
  },
  spawnInWorktree: {
    input: projectRef.extend({
      path: z.string().min(1),
      request: z.record(z.string(), z.unknown()),
    }),
    output: z.object({ threadId: z.string() }),
  },
  removeWorktree: {
    input: projectRef.extend({
      path: z.string().min(1),
      deleteBranch: z.boolean().default(false),
      force: z.boolean().default(false),
    }),
    output: z.object({
      archivedThreadIds: z.array(z.string()),
      deletedBranch: z.string().nullable(),
      log: z.string(),
    }),
  },
  getConfig: {
    input: projectRef,
    output: resolvedConfigSchema,
  },
  setConfig: {
    input: projectRef.extend({ config: projectConfigSchema.partial() }),
    output: resolvedConfigSchema,
  },
});
