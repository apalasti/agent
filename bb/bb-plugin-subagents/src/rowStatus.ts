import { useCallback, useEffect, useRef } from "react";
import {
  useRealtime,
  useRpc,
  type PluginComposerThreadRowStatus,
  type PluginContentScriptContext,
} from "@get-bb/plugin-sdk/app";
import { SUBAGENTS_CHANGED, type rpcContract, type ThreadSummary } from "./contract";

export const ROW_STATUS_POLL_MS = 3_000;

type Setter = (threadId: string, status: PluginComposerThreadRowStatus | null) => void;

export function rowStatusFor(running: number): PluginComposerThreadRowStatus {
  return { icon: "Bot", label: `${running} subagent${running === 1 ? "" : "s"} running`, tone: "running" };
}

export type RowStatusDiff = {
  set: Array<[threadId: string, status: PluginComposerThreadRowStatus]>;
  clear: string[];
  next: Map<string, string>;
};

/** `applied` maps each decorated thread to the label it currently shows. */
export function diffRowStatuses(applied: ReadonlyMap<string, string>, threads: readonly ThreadSummary[]): RowStatusDiff {
  const next = new Map<string, string>();
  const set: RowStatusDiff["set"] = [];
  for (const thread of threads) {
    if (thread.running <= 0) continue;
    const status = rowStatusFor(thread.running);
    next.set(thread.threadId, status.label);
    if (applied.get(thread.threadId) !== status.label) set.push([thread.threadId, status]);
  }
  const clear = [...applied.keys()].filter((threadId) => !next.has(threadId));
  return { set, clear, next };
}

// The content-script context has no rpc client and React slots have no row-status
// setter, so the script hands its setter to the overlay poller through this module.
let sink: { setStatus: Setter; applied: Map<string, string> } | null = null;
let latest: readonly ThreadSummary[] | null = null;

function apply(threads: readonly ThreadSummary[]) {
  latest = threads;
  if (sink === null) return;
  const { set, clear, next } = diffRowStatuses(sink.applied, threads);
  for (const [threadId, status] of set) sink.setStatus(threadId, status);
  for (const threadId of clear) sink.setStatus(threadId, null);
  sink.applied = next;
}

export function mountRowStatus(context: Pick<PluginContentScriptContext, "signal" | "experimental_setThreadRowStatus">) {
  const setStatus = context.experimental_setThreadRowStatus;
  if (setStatus === undefined || context.signal.aborted) return;
  const mine = { setStatus, applied: new Map<string, string>() };
  sink = mine;
  if (latest !== null) apply(latest);
  const detach = () => {
    if (sink === mine) sink = null;
  };
  context.signal.addEventListener("abort", detach, { once: true });
  return detach;
}

/** App overlay: polls `summaries` while the window is visible and feeds the content script's setter. */
export function RowStatusPoller(): null {
  const rpc = useRpc<typeof rpcContract>();
  const inFlight = useRef(false);
  const poll = useCallback(() => {
    if (inFlight.current || document.hidden || sink === null) return;
    inFlight.current = true;
    rpc
      .call("summaries", {})
      .then((result) => apply(result.threads))
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
      });
  }, [rpc]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, ROW_STATUS_POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [poll]);
  useRealtime(SUBAGENTS_CHANGED, poll);
  return null;
}
