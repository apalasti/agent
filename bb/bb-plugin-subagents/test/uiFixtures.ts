import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract, Subagent } from "../src/contract";

export function makeSubagent(callId: string, overrides: Partial<Subagent> = {}): Subagent {
  return {
    agentId: `${callId}-0000-4000-8000-000000000000`,
    callId,
    description: callId,
    type: "Explore",
    model: null,
    background: true,
    status: "completed",
    startedAt: "2026-10-06T10:00:00.000Z",
    updatedAt: "2026-10-06T10:00:30.000Z",
    finishedAt: "2026-10-06T10:00:30.000Z",
    turns: 2,
    toolCalls: 3,
    lastActivity: null,
    result: null,
    outputFile: "/tmp/agent.output",
    parentAgentId: null,
    filesTouched: [],
    ...overrides,
  };
}

export function rpcHandlers(
  overrides: Partial<PluginRpcTestHandlers<typeof rpcContract>> = {},
): PluginRpcTestHandlers<typeof rpcContract> {
  const unused = (method: string) => () => {
    throw new Error(`unexpected rpc ${method}`);
  };
  return {
    threadSubagents: unused("threadSubagents"),
    transcript: unused("transcript"),
    summaries: unused("summaries"),
    ...overrides,
  };
}
