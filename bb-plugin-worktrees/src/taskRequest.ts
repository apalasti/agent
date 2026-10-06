import type { NewThreadComposerProps, NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { TASK_WORKTREE_PROVIDER_ID, type AgentDefaults, type TaskWorktreeInputs } from "./contract";

type EnvironmentArgs = NewThreadRequest["environment"];
type ProviderEnvironment = Extract<EnvironmentArgs, { type: "provider" }>;

/** Keeps the machine the composer picked, so the worktree is created where the user chose to run. */
export function machineOf(environment: EnvironmentArgs): ProviderEnvironment["machine"] {
  if (environment.type === "host" && environment.hostId) return { type: "existing", hostId: environment.hostId };
  if (environment.type === "provider") return environment.machine;
  return undefined;
}

export function taskWorktreeEnvironment(environment: EnvironmentArgs, inputs: TaskWorktreeInputs): ProviderEnvironment {
  const machine = machineOf(environment);
  return {
    type: "provider",
    environmentProviderId: TASK_WORKTREE_PROVIDER_ID,
    inputs: { ...inputs },
    ...(machine ? { machine } : {}),
  };
}

export function taskSpawnRequest(request: NewThreadRequest, inputs: TaskWorktreeInputs): NewThreadRequest {
  return { ...request, environment: taskWorktreeEnvironment(request.environment, inputs) };
}

type ComposerSeed = Pick<NewThreadComposerProps, "defaultProviderId" | "defaultModel" | "defaultReasoningLevel">;

/** Seeds the composer only when the project remembers nothing; the composer applies a remembered choice itself. */
export function composerSeed(defaults: AgentDefaults | null): ComposerSeed {
  if (defaults === null || defaults.source === "project") return {};
  return {
    defaultProviderId: defaults.providerId,
    defaultModel: defaults.model,
    defaultReasoningLevel: defaults.reasoningLevel as NewThreadComposerProps["defaultReasoningLevel"],
  };
}
