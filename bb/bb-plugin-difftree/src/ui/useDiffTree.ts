import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { DIFF_CHANGED, diffChangedSchema, type rpcContract, type Scope, type TreeResult } from "../contract";

export const REFETCH_DEBOUNCE_MS = 400;

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface DiffTree {
  /** The last tree that arrived; kept on screen while a refetch is in flight or after it fails. */
  result: TreeResult | null;
  error: string | null;
  refreshing: boolean;
  refetch(): void;
  /** Remembers the scope for the environment (null returns to the default) and shows the tree under it. */
  setScope(scope: Scope | null): void;
}

/** Plugin signals are not replayed, so every reconnect after the first connection refetches. */
function useOnReconnect(callback: () => void) {
  const state = useRealtimeConnectionState();
  const previous = useRef(state);
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (state === "connected" && previous.current === "reconnecting") latest.current();
    previous.current = state;
  }, [state]);
}

function useDebounced(callback: () => void, ms: number): () => void {
  const latest = useRef(callback);
  latest.current = callback;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current();
    }, ms);
  }, [ms]);
}

export function useDiffTree(threadId: string): DiffTree {
  const rpc = useRpc<typeof rpcContract>();
  const [result, setResult] = useState<TreeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const sequence = useRef(0);

  const run = useCallback((load: () => Promise<TreeResult>) => {
    const ticket = ++sequence.current;
    setRefreshing(true);
    load().then(
      (next) => {
        if (ticket !== sequence.current) return;
        setResult(next);
        setError(null);
        setRefreshing(false);
      },
      (cause: unknown) => {
        if (ticket !== sequence.current) return;
        setError(errorMessage(cause));
        setRefreshing(false);
      },
    );
  }, []);

  const refetch = useCallback(() => run(() => rpc.call("tree", { threadId, scope: null })), [rpc, run, threadId]);
  const setScope = useCallback(
    (scope: Scope | null) => run(() => rpc.call("set_scope", { threadId, scope })),
    [rpc, run, threadId],
  );

  useEffect(() => {
    setResult(null);
    setError(null);
    refetch();
  }, [refetch]);

  const environmentId = result?.environmentId ?? null;
  const debouncedRefetch = useDebounced(refetch, REFETCH_DEBOUNCE_MS);
  useRealtime(DIFF_CHANGED, (payload) => {
    const parsed = diffChangedSchema.safeParse(payload);
    if (parsed.success && environmentId !== null && parsed.data.environmentId === environmentId) debouncedRefetch();
  });
  useOnReconnect(refetch);

  return { result, error, refreshing, refetch, setScope };
}
