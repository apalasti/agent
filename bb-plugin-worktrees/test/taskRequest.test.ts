import { describe, expect, it } from "vitest";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { taskSpawnRequest } from "../src/taskRequest";

const base = {
  projectId: "p1",
  providerId: "claude-code",
  model: "opus",
  reasoningLevel: "high",
  permissionMode: "default",
  executionInputSources: {},
  input: [{ type: "text", text: "do it" }],
} as unknown as Omit<NewThreadRequest, "environment">;

describe("taskSpawnRequest", () => {
  it("swaps the composer's environment for a task-worktree provider environment on the same machine", () => {
    const request = {
      ...base,
      environment: { type: "host", hostId: "h1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
    } as NewThreadRequest;
    expect(taskSpawnRequest(request, { branch: "feat/x", from: "wizz/main" })).toEqual({
      ...base,
      environment: {
        type: "provider",
        environmentProviderId: "task-worktree",
        inputs: { branch: "feat/x", from: "wizz/main" },
        machine: { type: "existing", hostId: "h1" },
      },
    });
  });

  it("keeps a provider machine and omits machine when the composer named none", () => {
    const fromProvider = taskSpawnRequest(
      {
        ...base,
        environment: {
          type: "provider",
          environmentProviderId: "task-worktree",
          inputs: null,
          machine: { type: "new", machineProviderId: "cloud", inputs: null },
        },
      } as NewThreadRequest,
      { branch: "b" },
    );
    expect(fromProvider.environment).toMatchObject({ machine: { type: "new", machineProviderId: "cloud" } });

    const fromDefault = taskSpawnRequest({ ...base, environment: { type: "project-default" } } as NewThreadRequest, {});
    expect(fromDefault.environment).toEqual({ type: "provider", environmentProviderId: "task-worktree", inputs: {} });
  });
});
