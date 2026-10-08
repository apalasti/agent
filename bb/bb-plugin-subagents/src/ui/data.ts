import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { SUBAGENTS_CHANGED, type rpcContract, type Subagent, type TranscriptEntry } from "../contract";
import { isRunning, pollInterval } from "./format";

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
  if (typeof payload !== "object" || payload === null || !("threadId" in payload)) return true;
  const target = (payload as { threadId: unknown }).threadId;
  return typeof target !== "string" || target === threadId;
}

/** Calls `load` and keeps only the newest response, so a slow poll never overwrites a fresher one. */
function useLatest<T>(load: (rpc: Rpc) => Promise<T>, deps: readonly unknown[]) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const refetch = useCallback(() => {
    const ticket = ++sequence.current;
    load(rpc).then(
      (next) => {
        if (ticket !== sequence.current) return;
        setData(next);
        setError(null);
      },
      (cause: unknown) => {
        if (ticket === sequence.current) setError(message(cause));
      },
    );
  }, [rpc, ...deps]);
  useEffect(() => {
    setData(null);
    setError(null);
    refetch();
  }, [refetch]);
  return { data, error, refetch };
}

export function useThreadSubagents(threadId: string) {
  const { data, error, refetch } = useLatest((rpc) => rpc.call("threadSubagents", { threadId }), [threadId]);
  const anyRunning = data?.subagents.some(isRunning) ?? false;
  useInterval(refetch, pollInterval(anyRunning));
  useRealtime(SUBAGENTS_CHANGED, (payload) => {
    if (concernsThread(payload, threadId)) refetch();
  });
  return { subagents: data?.subagents ?? null, environment: data?.environment ?? null, error, refetch };
}

export function useThreadTally(threadId: string) {
  const { data, refetch } = useLatest(
    (rpc) =>
      rpc
        .call("summaries", { threadIds: [threadId] })
        .then((result) => result.threads.find((thread) => thread.threadId === threadId) ?? { threadId, running: 0, total: 0 }),
    [threadId],
  );
  useInterval(refetch, pollInterval((data?.running ?? 0) > 0));
  useRealtime(SUBAGENTS_CHANGED, (payload) => {
    if (concernsThread(payload, threadId)) refetch();
  });
  return data;
}

export type TranscriptState = {
  entries: TranscriptEntry[];
  truncated: boolean;
  children: Subagent[];
};

/** Loads only while `enabled`; reloads whenever `version` changes and every 2 s while the agent runs. */
export function useTranscript(threadId: string, callId: string, enabled: boolean, running: boolean, version: string) {
  const { data, error, refetch } = useLatest(
    (rpc): Promise<TranscriptState | null> =>
      enabled ? rpc.call("transcript", { threadId, callId }) : Promise.resolve(null),
    [threadId, callId, enabled],
  );
  const firstVersion = useRef(true);
  useEffect(() => {
    if (firstVersion.current) {
      firstVersion.current = false;
      return;
    }
    if (enabled) refetch();
  }, [version]);
  useInterval(refetch, enabled && running ? 2_000 : null);
  return { transcript: data, error };
}

export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), active ? 1_000 : null);
  useEffect(() => {
    if (active) setNow(Date.now());
  }, [active]);
  return now;
}

/** Keeps a scroll container pinned to its bottom as content grows, until the user scrolls up. */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, active: boolean, contentKey: unknown) {
  const pinned = useRef(true);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const onScroll = () => {
      pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [ref]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || !active || !pinned.current) return;
    element.scrollTop = element.scrollHeight;
  }, [ref, active, contentKey]);
}
