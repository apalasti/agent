import { useEffect, useMemo, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useBbNavigate,
  useSdk,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TASK_WORKTREE_PROVIDER_ID } from "../contract";
import { composerSeed, taskSpawnRequest } from "../taskRequest";
import { errorMessage, useAgentDefaults } from "./data";
import { TaskFields, useBranchCheck, useProjectConfig } from "./fields";
import { cleanInputs, setDialogTaskInputs } from "./taskDraft";

const SEED_ENVIRONMENT: NewThreadRequest["environment"] = {
  type: "provider",
  environmentProviderId: TASK_WORKTREE_PROVIDER_ID,
  inputs: null,
};

export function NewTaskDialog({
  projectId,
  projectName,
  onClose,
  onNavigate,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const agent = useAgentDefaults(projectId);
  const { config } = useProjectConfig(projectId);
  const [branch, setBranch] = useState("");
  const [from, setFrom] = useState("");
  const check = useBranchCheck(projectId, branch);
  const inputs = useMemo(() => cleanInputs(branch, from), [branch, from]);
  const base = inputs.from ?? config?.effectiveBaseRef ?? null;

  useEffect(() => {
    setDialogTaskInputs(inputs);
  }, [inputs]);
  useEffect(() => () => setDialogTaskInputs(null), []);

  const submit = async (request: NewThreadRequest) => {
    if (request.projectId !== projectId) throw failure(`A task worktree is created in ${projectName}; pick that project.`);
    if (check.state === "empty") throw failure("Name the branch for this task first.");
    if (check.state === "invalid") throw failure(check.message);
    if (check.state === "checking") throw failure("Still checking the branch name — try again in a moment.");
    try {
      const thread = await sdk.threads.spawn({ ...taskSpawnRequest(request, inputs) });
      onClose();
      navigate.toThread(thread.id);
      onNavigate();
    } catch (cause) {
      throw failure(errorMessage(cause));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(52rem,calc(100vw-2rem))] max-w-none gap-5">
        <DialogHeader>
          <DialogTitle>New task in {projectName}</DialogTitle>
          <DialogDescription>
            Creates a worktree on a new branch{base ? ` from ${base}` : ""} and starts the thread in it.
          </DialogDescription>
        </DialogHeader>
        <TaskFields
          projectId={projectId}
          branch={branch}
          onBranchChange={setBranch}
          from={from}
          onFromChange={setFrom}
          defaultBase={config?.effectiveBaseRef ?? null}
          check={check}
          autoFocus
        />
        <div className="min-w-0">
          {agent.loaded ? (
            <NewThreadComposer
              {...composerSeed(agent.defaults)}
              defaultProjectId={projectId}
              defaultEnvironment={SEED_ENVIRONMENT}
              layout="document"
              draftKey={`worktrees:new-task:${projectId}`}
              placeholder="Describe the task…"
              onSubmit={submit}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function failure(message: string): Error {
  toast.error(message);
  return new Error(message);
}
