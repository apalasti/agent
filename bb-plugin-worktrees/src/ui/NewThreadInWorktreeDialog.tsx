import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreadActions,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatHomePathForDisplay } from "@/lib/utils";
import type { WorktreeNode } from "../group";
import { errorMessage, useWorktreesRpc } from "./data";

/** For a worktree no live thread runs in yet, so there is no bb environment to reuse. */
export function NewThreadInWorktreeDialog({
  projectId,
  group,
  onClose,
  onNavigate,
}: {
  projectId: string;
  group: WorktreeNode;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const rpc = useWorktreesRpc();
  const actions = experimental_useSidebarThreadActions();
  const path = group.path ?? "";

  const submit = async (request: NewThreadRequest) => {
    try {
      const { threadId } = await rpc.call("spawnInWorktree", {
        projectId,
        path,
        request: request as unknown as Record<string, unknown>,
      });
      onClose();
      actions.open(threadId);
      onNavigate();
    } catch (cause) {
      const message = errorMessage(cause);
      toast.error(message);
      throw new Error(message);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(52rem,calc(100vw-2rem))] max-w-none gap-5">
        <DialogHeader>
          <DialogTitle>New thread in {group.label}</DialogTitle>
          <DialogDescription className="truncate" title={path}>
            Runs in {formatHomePathForDisplay(path)} — the environment choice below is replaced by this worktree.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0">
          <NewThreadComposer
            defaultProjectId={projectId}
            layout="document"
            draftKey={`worktrees:new-thread:${path}`}
            onSubmit={submit}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
