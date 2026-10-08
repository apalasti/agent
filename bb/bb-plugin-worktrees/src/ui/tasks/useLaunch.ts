import { useEffect, useState } from "react";
import { useBbNavigate, type ExperimentalProviderModelPickerValue } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ScratchView } from "../../contract";
import { errorMessage, useAgentDefaults } from "../data";

const PI_PROVIDER_ID = "pi";

export function needsPiWarning(view: ScratchView | null, providerId: string | null): boolean {
  if (view === null || providerId === null || providerId === PI_PROVIDER_ID) return false;
  const hasOpenIssues = view.efforts.some((effort) => effort.issues.some((issue) => issue.status !== "done"));
  return (view.piSubagents.orchestrate && hasOpenIssues) || view.piSubagents.tickets.length > 0;
}

export type AgentRequest = { request?: Record<string, unknown> };
export type Modifiers = { metaKey: boolean; ctrlKey: boolean };
export type Launch = (
  key: string,
  label: string,
  event: Modifiers,
  start: (agentRequest: AgentRequest) => Promise<{ threadId: string }>,
) => void;

export function useLaunch(target: { projectId: string; path: string }, reload: () => void) {
  const navigate = useBbNavigate();
  const [agent, setAgent] = useState<ExperimentalProviderModelPickerValue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { defaults } = useAgentDefaults(target.projectId, PI_PROVIDER_ID);
  useEffect(() => {
    if (agent !== null || defaults === null) return;
    const { providerId, model, reasoningLevel, serviceTier } = defaults;
    setAgent({ providerId, model, reasoningLevel, ...(serviceTier ? { serviceTier } : {}) } as ExperimentalProviderModelPickerValue);
  }, [defaults, agent]);

  const launch: Launch = (key, label, event, start) => {
    const stay = event.metaKey || event.ctrlKey;
    setBusy(key);
    const request = agent === null ? null : Object.fromEntries(Object.entries(agent).filter(([, value]) => value !== undefined));
    start(request === null ? {} : { request }).then(
      ({ threadId }) => {
        setBusy(null);
        if (stay) {
          toast.success(`Started ${label}`, { action: { label: "Open", onClick: () => navigate.toThread(threadId) } });
          reload();
        } else {
          toast.success(`Started ${label}`);
          navigate.toThread(threadId);
        }
      },
      (cause: unknown) => {
        setBusy(null);
        toast.error(errorMessage(cause));
      },
    );
  };

  return { agent, setAgent, busy, launch };
}
