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

export const scratchTicketSchema = z.object({
  ref: z.string(),
  number: z.string(),
  slug: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  claimed: z.string().nullable(),
  blockedBy: z.array(z.string()),
  /** blockedBy minus the closed ones. */
  blockers: z.array(z.string()),
  state: z.enum(["frontier", "blocked", "done"]),
  path: z.string(),
});
export type ScratchTicket = z.infer<typeof scratchTicketSchema>;

export const scratchIssueSchema = z.object({
  ref: z.string(),
  number: z.string(),
  slug: z.string(),
  title: z.string(),
  status: z.string(),
  path: z.string(),
});
export type ScratchIssue = z.infer<typeof scratchIssueSchema>;

export const scratchEffortSchema = z.object({
  slug: z.string(),
  dir: z.string(),
  mapPath: z.string().nullable(),
  tickets: z.array(scratchTicketSchema),
  issues: z.array(scratchIssueSchema),
  handoffReady: z.boolean(),
});
export type ScratchEffort = z.infer<typeof scratchEffortSchema>;

export const scratchIndexSchema = z.object({
  root: z.string(),
  scratchDir: z.string(),
  efforts: z.array(scratchEffortSchema),
});
export type ScratchIndex = z.infer<typeof scratchIndexSchema>;

export const agentSelectionSchema = z.object({
  providerId: z.string(),
  model: z.string(),
  reasoningLevel: z.string(),
  serviceTier: z.string().optional(),
});
export type AgentSelection = z.infer<typeof agentSelectionSchema>;

/** `request` carries the provider/model/reasoning/permission choice; prompt and environment are the plugin's. */
const workflowTarget = projectRef.extend({
  path: z.string().min(1),
  request: z.record(z.string(), z.unknown()).optional(),
});

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
  scratch: {
    input: projectRef.extend({ path: z.string().min(1) }),
    output: scratchIndexSchema,
  },
  runTicket: {
    input: workflowTarget.extend({ ref: z.string().min(1) }),
    output: z.object({ threadId: z.string() }),
  },
  orchestrate: {
    input: workflowTarget.extend({ effort: z.string().min(1), issues: z.array(z.string().min(1)) }),
    output: z.object({ threadId: z.string() }),
  },
  chart: {
    input: workflowTarget.extend({ idea: z.string().trim().min(1) }),
    output: z.object({ threadId: z.string() }),
  },
  handoff: {
    input: workflowTarget.extend({ effort: z.string().min(1) }),
    output: z.object({ threadId: z.string() }),
  },
  agentDefaults: {
    input: projectRef,
    output: agentSelectionSchema.nullable(),
  },
});

export type WorkflowThreadMetadata = {
  kind: "ticket" | "orchestrate" | "chart" | "handoff";
  effort: string | null;
  ref: string | null;
  path: string;
};
