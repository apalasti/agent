import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { Agent, rpcContract, Step, ThreadAgents, Workflow } from "../src/contract";

export const T0 = Date.parse("2026-10-08T10:00:00Z");

export function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    at: T0,
    endAt: T0 + 1_000,
    kind: "tool",
    name: "bash",
    summary: "npm test",
    input: '{"command":"npm test"}',
    result: "ok",
    isError: false,
    ...overrides,
  };
}

export function makeAgent(agentId: string, overrides: Partial<Agent> = {}): Agent {
  return {
    agentId,
    parentAgentId: null,
    description: agentId,
    agentType: "general-purpose",
    model: "claude-haiku-5-5",
    status: "done",
    startedAt: T0,
    endedAt: T0 + 30_000,
    prompt: "Do the thing",
    report: "All done.",
    steps: [],
    files: [],
    errors: 0,
    totalTokens: 12_000,
    context: 20_000,
    contextWindow: 200_000,
    workflowId: null,
    callId: null,
    pending: false,
    ...overrides,
  };
}

export function makeWorkflow(runId: string, overrides: Partial<Workflow> = {}): Workflow {
  return {
    runId,
    name: runId,
    description: null,
    status: "done",
    phases: [],
    startedAt: T0,
    endedAt: T0 + 24_500,
    done: 0,
    failed: 0,
    totalTokens: null,
    error: null,
    ...overrides,
  };
}

export function threadAgents(agents: Agent[], overrides: Partial<ThreadAgents> = {}): ThreadAgents {
  return {
    sessionId: "sess-1",
    cwd: "/w",
    environmentId: "env_1",
    lead: { model: "claude-opus-5-5", context: 50_000, contextWindow: 200_000 },
    agents,
    workflows: [],
    ...overrides,
  };
}

export function rpcHandlers(data: ThreadAgents): PluginRpcTestHandlers<typeof rpcContract> {
  return { threadAgents: () => data };
}
