import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, ThreadAgents } from "../contract";

const RUNNING_POLL_MS = 2_000;
const IDLE_POLL_MS = 15_000;

type Polled = { threadId: string; data: ThreadAgents | null; error: string | null };

export function useThreadAgents(threadId: string): { data: ThreadAgents | null; error: string | null } {
  const rpc = useRpc<typeof rpcContract>();
  const [polled, setPolled] = useState<Polled>({ threadId, data: null, error: null });
  const issued = useRef(0);
  const shown = useRef(0);

  const reload = useCallback(() => {
    const request = ++issued.current;
    const show = (update: (previous: Polled) => Polled) => {
      if (request < shown.current) return;
      shown.current = request;
      setPolled(update);
    };
    rpc.call("threadAgents", { threadId }).then(
      (data) => show(() => ({ threadId, data, error: null })),
      (cause: unknown) => {
        const error = cause instanceof Error ? cause.message : String(cause);
        show((previous) => ({ threadId, data: previous.threadId === threadId ? previous.data : null, error }));
      },
    );
  }, [rpc, threadId]);

  const current = polled.threadId === threadId ? polled : { data: null, error: null };
  const running = current.data?.agents.some((agent) => agent.status === "running") ?? false;
  useEffect(reload, [reload]);
  useEffect(() => {
    const id = setInterval(reload, running ? RUNNING_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(id);
  }, [reload, running]);

  return { data: current.data, error: current.error };
}

export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
