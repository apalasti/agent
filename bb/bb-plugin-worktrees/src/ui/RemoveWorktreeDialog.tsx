import { useEffect, useId, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatHomePathForDisplay } from "@/lib/utils";
import type { WorktreeStatus } from "../contract";
import { flattenThreads, type WorktreeNode } from "../group";
import { Callout, CodeWell, Spinner } from "../kit";
import { errorMessage, useWorktreesRpc } from "./data";

export function RemoveWorktreeDialog({
  projectId,
  group,
  activeThreadId,
  onClose,
}: {
  projectId: string;
  group: WorktreeNode;
  activeThreadId: string | null;
  onClose: () => void;
}) {
  const rpc = useWorktreesRpc();
  const navigate = useBbNavigate();
  const path = group.path ?? "";
  const branch = group.worktree?.branch ?? null;
  const threads = flattenThreads(group.threads);
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const deleteBranchId = useId();
  const forceId = useId();

  useEffect(() => {
    let cancelled = false;
    rpc.call("worktreeStatus", { projectId, path }).then(
      (result) => !cancelled && setStatus(result),
      (cause: unknown) => !cancelled && setStatusError(errorMessage(cause)),
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, path]);

  const dirty = status?.dirtyFiles ?? 0;
  const needsForce = dirty > 0 && !force;

  const remove = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await rpc.call("removeWorktree", { projectId, path, deleteBranch, force });
      toast.success(
        result.deletedBranch ? `Removed ${group.label} and deleted ${result.deletedBranch}` : `Removed ${group.label}`,
      );
      if (activeThreadId !== null && result.archivedThreadIds.includes(activeThreadId)) navigate.toProject(projectId);
      onClose();
    } catch (cause) {
      setFailure(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove worktree {group.label}?</DialogTitle>
          <DialogDescription className="truncate" title={path}>
            {formatHomePathForDisplay(path)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 text-sm">
          {threads.length > 0 ? (
            <div className="grid gap-1.5">
              <p>
                {threads.length === 1 ? "This thread will be archived:" : `These ${threads.length} threads will be archived:`}
              </p>
              <ul className="max-h-40 overflow-y-auto rounded-md bg-surface-recessed px-2.5 py-1.5 text-muted-foreground">
                {threads.map((thread) => (
                  <li key={thread.id} className="truncate py-0.5">
                    {thread.displayTitle}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">No bb threads run in this worktree.</p>
          )}

          {status === null && statusError === null ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              Checking for uncommitted changes…
            </p>
          ) : null}
          {statusError !== null ? (
            <p className="text-xs text-muted-foreground">Couldn't check for uncommitted changes: {statusError}</p>
          ) : null}
          {dirty > 0 ? (
            <Callout tone="error" className="m-0">
              {dirty} uncommitted {dirty === 1 ? "change" : "changes"} will be lost.
            </Callout>
          ) : null}
          {status !== null && status.ahead > 0 ? (
            <p className="text-xs text-muted-foreground">
              {status.ahead} {status.ahead === 1 ? "commit is" : "commits are"} not on {status.upstream ?? "any upstream"}.
            </p>
          ) : null}

          {branch !== null ? (
            <div className="flex items-center gap-2">
              <Checkbox id={deleteBranchId} checked={deleteBranch} onCheckedChange={(value) => setDeleteBranch(value === true)} />
              <Label htmlFor={deleteBranchId} className="font-normal">
                Also delete branch <span className="font-mono">{branch}</span>
              </Label>
            </div>
          ) : null}
          {dirty > 0 ? (
            <div className="flex items-center gap-2">
              <Checkbox id={forceId} checked={force} onCheckedChange={(value) => setForce(value === true)} />
              <Label htmlFor={forceId} className="font-normal">
                Remove anyway, discarding uncommitted changes
              </Label>
            </div>
          ) : null}

          {failure !== null ? (
            <div role="alert" className="grid gap-1">
              <p className="text-destructive-text">Removal failed.</p>
              <CodeWell tone="error">{failure}</CodeWell>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void remove()} disabled={busy || needsForce || (status === null && statusError === null)}>
            {busy ? "Removing…" : "Remove worktree"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
