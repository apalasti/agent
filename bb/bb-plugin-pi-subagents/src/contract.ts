import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const stepSchema = z.object({
  at: z.number(),
  endAt: z.number().nullable(),
  kind: z.enum(["tool", "text"]),
  name: z.string(),
  summary: z.string(),
  input: z.string(),
  result: z.string().nullable(),
  isError: z.boolean(),
});
export type Step = z.infer<typeof stepSchema>;

export const fileChangeSchema = z.object({
  path: z.string(),
  added: z.number(),
  removed: z.number(),
});
export type FileChange = z.infer<typeof fileChangeSchema>;

export const agentStatusSchema = z.enum(["running", "done", "needs-look", "failed", "unknown"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const agentSchema = z.object({
  agentId: z.string(),
  parentAgentId: z.string().nullable(),
  description: z.string(),
  agentType: z.string(),
  model: z.string().nullable(),
  status: agentStatusSchema,
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  prompt: z.string(),
  report: z.string().nullable(),
  steps: z.array(stepSchema),
  files: z.array(fileChangeSchema),
  errors: z.number(),
  totalTokens: z.number().nullable(),
  context: z.number(),
  contextWindow: z.number(),
  workflowId: z.string().nullable(),
});
export type Agent = z.infer<typeof agentSchema>;

export const workflowSchema = z.object({
  runId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: agentStatusSchema,
  phases: z.array(z.string()),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  done: z.number(),
  failed: z.number(),
  totalTokens: z.number().nullable(),
  error: z.string().nullable(),
});
export type Workflow = z.infer<typeof workflowSchema>;

export const threadAgentsSchema = z.object({
  sessionId: z.string().nullable(),
  cwd: z.string().nullable(),
  environmentId: z.string().nullable(),
  lead: z.object({ model: z.string().nullable(), context: z.number(), contextWindow: z.number() }).nullable(),
  agents: z.array(agentSchema),
  workflows: z.array(workflowSchema),
});
export type ThreadAgents = z.infer<typeof threadAgentsSchema>;

export const rpcContract = defineRpcContract({
  threadAgents: {
    input: z.object({ threadId: z.string().min(1) }),
    output: threadAgentsSchema,
  },
});
