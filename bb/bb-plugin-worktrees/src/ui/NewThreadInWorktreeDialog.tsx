import {
  experimental_NewThreadComposer as NewThreadComposer,
  useBbNavigate,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { formatHomePathForDisplay } from "@/lib/utils";
import type { WorktreeNode } from "../group";
import { composerSeed } from "../taskRequest";
import { errorMessage, useAgentDefaults, useWorktreesRpc } from "./data";

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
  const navigate = useBbNavigate();
  const agent = useAgentDefaults(projectId);
  const path = group.path ?? "";

  const submit = async (request: NewThreadRequest) => {
    try {
      const { threadId } = await rpc.call("spawnInWorktree", {
        projectId,
        path,
        request: request as unknown as Record<string, unknown>,
      });
      onClose();
      navigate.toThread(threadId);
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
          <DialogDescription>Starts a thread in this worktree's existing checkout.</DialogDescription>
        </DialogHeader>
        {/* The composer cannot show a worktree path in its environment chips, and has no prop to hide them. */}
        <div className="flex items-start gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <Icon name="GitBranch" className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{group.label}</div>
            <div className="truncate font-mono text-xs text-muted-foreground" title={path}>
              {formatHomePathForDisplay(path)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              The project, environment and branch pickers under the prompt don't apply: the thread always runs here.
            </div>
          </div>
        </div>
        <div className="min-w-0">
          {agent.loaded ? (
            <NewThreadComposer
              {...composerSeed(agent.defaults)}
              defaultProjectId={projectId}
              layout="document"
              draftKey={`worktrees:new-thread:${path}`}
              onSubmit={submit}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
