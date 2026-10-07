import { useEffect, useState, type ReactNode } from "react";
import { experimental_Diff as Diff, useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import type { ChangedFile, PatchResult, rpcContract, Scope } from "../contract";
import { errorMessage } from "./useDiffTree";

type PatchState =
  | { status: "loading"; previous: PatchResult | null }
  | { status: "done"; result: PatchResult }
  | { status: "error"; message: string };

function Note({ children, role }: { children: ReactNode; role?: "alert" }) {
  return (
    <p role={role} className="px-3 py-2 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/** Why bb will not show a patch for this file, or null when it will. */
export function noPatchReason(file: ChangedFile): string | null {
  if (file.binary) return "Binary file: there is no text patch to show.";
  if (file.tooLarge) {
    return `This file's patch is too large for bb to load (+${file.additions} −${file.deletions}). Open the file to read it.`;
  }
  return null;
}

function PatchBody({ threadId, scope, file }: { threadId: string; scope: Scope; file: ChangedFile }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<PatchState>({ status: "loading", previous: null });
  const [attempt, setAttempt] = useState(0);
  const scopeKey = JSON.stringify(scope);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ status: "loading", previous: current.status === "done" ? current.result : null }));
    rpc.call("patch", { threadId, scope, path: file.path }).then(
      (result) => {
        if (!cancelled) setState({ status: "done", result });
      },
      (cause: unknown) => {
        if (!cancelled) setState({ status: "error", message: errorMessage(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
    // scope by value via scopeKey; the counts refetch the patch when the file changes underneath it.
  }, [rpc, threadId, scopeKey, file.path, file.additions, file.deletions, attempt]);

  if (state.status === "error") {
    return (
      <Note role="alert">
        <span className="text-destructive">Couldn't load the patch: {state.message}</span>{" "}
        <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </Button>
      </Note>
    );
  }
  const shown = state.status === "done" ? state.result : state.previous;
  if (shown === null) return <Note>Loading patch…</Note>;
  if (shown.outcome === "unavailable") return <Note>{shown.message}</Note>;
  if (shown.patch.trim() === "") return <Note>No text changes (only the file mode or metadata changed).</Note>;
  return (
    <>
      <Diff patch={shown.patch} path={file.path} className="text-xs" />
      {shown.truncated ? <Note>bb truncated this patch; open the file to see all of it.</Note> : null}
    </>
  );
}

export function FilePatch({ threadId, scope, file }: { threadId: string; scope: Scope; file: ChangedFile }) {
  const reason = noPatchReason(file);
  return (
    <div role="group" aria-label={`Patch for ${file.path}`} className="border-y border-border bg-background">
      {reason === null ? <PatchBody threadId={threadId} scope={scope} file={file} /> : <Note>{reason}</Note>}
    </div>
  );
}
