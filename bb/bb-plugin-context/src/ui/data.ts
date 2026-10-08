import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { CONTEXT_CHANGED, type ContextReport, type Meter, type rpcContract } from "../contract";
import { isBusy } from "./format";

export const POLL_WHILE_RUNNING_MS = 5_000;

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function useInterval(callback: () => void, ms: number | null) {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => latest.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function concernsThread(payload: unknown, threadId: string): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  return (payload as { threadId?: unknown }).threadId === threadId;
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

type WithWindow = { threadStatus: string; window: Meter["window"] };

/** A new session reports no window until its first measurement; the window it ran in before the course change is the best guess. */
export function keepWindowWhileRecomputing<T extends WithWindow>(previous: T | null, next: T): T {
  if (previous === null || !next.window.recomputing || next.window.contextWindow !== null) return next;
  return {
    ...next,
    window: { ...next.window, contextWindow: previous.window.contextWindow, autoCompactAt: next.window.autoCompactAt ?? previous.window.autoCompactAt },
  };
}

/** Keeps the newest response and the last good data across errors; refetches on this thread's change signal. */
function useThreadData<T extends WithWindow>(threadId: string, load: (rpc: Rpc, threadId: string) => Promise<T>) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const refetch = useCallback(() => {
    const ticket = ++sequence.current;
    loadRef.current(rpc, threadId).then(
      (next) => {
        if (ticket !== sequence.current) return;
        setData((previous) => keepWindowWhileRecomputing(previous, next));
        setError(null);
      },
      (cause: unknown) => {
        if (ticket === sequence.current) setError(message(cause));
      },
    );
  }, [rpc, threadId]);
  useEffect(() => {
    setData(null);
    setError(null);
    refetch();
  }, [refetch]);
  useRealtime(CONTEXT_CHANGED, (payload) => {
    if (concernsThread(payload, threadId)) refetch();
  });
  useOnReconnect(refetch);
  useInterval(refetch, data !== null && isBusy(data.threadStatus) ? POLL_WHILE_RUNNING_MS : null);
  return { data, error, refetch };
}

export function useMeter(threadId: string) {
  const { data, error, refetch } = useThreadData<Meter>(threadId, (rpc, id) => rpc.call("meter", { threadId: id }));
  return { meter: data, error, refetch };
}

export function useReport(threadId: string) {
  const { data, error, refetch } = useThreadData<ContextReport>(threadId, (rpc, id) => rpc.call("report", { threadId: id }));
  return { report: data, error, refetch };
}
