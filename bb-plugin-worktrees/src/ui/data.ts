import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { WORKTREES_CHANGED, type rpcContract, type Worktree, type WorktreeStatus } from "../contract";

export const REFRESH_INTERVAL_MS = 30_000;

export function useWorktreesRpc() {
  return useRpc<typeof rpcContract>();
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Bumps on the backend's change signal and on an interval, so consumers know when to refetch. */
export function useRefreshEpoch(): number {
  const [epoch, setEpoch] = useState(0);
  const bump = useCallback(() => setEpoch((value) => value + 1), []);
  useRealtime(WORKTREES_CHANGED, bump);
  useEffect(() => {
    const timer = setInterval(bump, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [bump]);
  return epoch;
}

export type ProjectWorktrees = {
  worktrees: Record<string, readonly Worktree[] | undefined>;
  errors: Record<string, string | undefined>;
};

export function useProjectWorktrees(projectIds: readonly string[], epoch: number): ProjectWorktrees {
  const rpc = useWorktreesRpc();
  const [state, setState] = useState<ProjectWorktrees>({ worktrees: {}, errors: {} });
  const key = projectIds.join("\n");

  useEffect(() => {
    let cancelled = false;
    for (const projectId of key === "" ? [] : key.split("\n")) {
      rpc.call("listWorktrees", { projectId }).then(
        (result) => {
          if (cancelled) return;
          setState((prev) => ({
            worktrees: { ...prev.worktrees, [projectId]: result.worktrees },
            errors: { ...prev.errors, [projectId]: undefined },
          }));
        },
        (cause: unknown) => {
          if (cancelled) return;
          setState((prev) => ({
            worktrees: { ...prev.worktrees, [projectId]: prev.worktrees[projectId] ?? [] },
            errors: { ...prev.errors, [projectId]: errorMessage(cause) },
          }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [rpc, key, epoch]);

  return state;
}

type StatusEntry = { status: WorktreeStatus | null; epoch: number; inFlight: boolean };

/** Caches worktreeStatus per path; a row asks only while it is on screen. */
export class WorktreeStatusStore {
  private entries = new Map<string, StatusEntry>();
  private listeners = new Set<() => void>();

  constructor(private readonly fetchStatus: (projectId: string, path: string) => Promise<WorktreeStatus>) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  get(path: string): WorktreeStatus | null {
    return this.entries.get(path)?.status ?? null;
  }

  request(projectId: string, path: string, epoch: number): void {
    const entry = this.entries.get(path);
    if (entry !== undefined && (entry.inFlight || entry.epoch >= epoch)) return;
    this.entries.set(path, { status: entry?.status ?? null, epoch, inFlight: true });
    this.fetchStatus(projectId, path).then(
      (status) => this.settle(path, epoch, status),
      () => this.settle(path, epoch, entry?.status ?? null),
    );
  }

  private settle(path: string, epoch: number, status: WorktreeStatus | null) {
    this.entries.set(path, { status, epoch, inFlight: false });
    for (const listener of this.listeners) listener();
  }
}

export const StatusStoreContext = createContext<{ store: WorktreeStatusStore; epoch: number } | null>(null);

export function useStatusStore(epoch: number) {
  const rpc = useWorktreesRpc();
  const store = useMemo(
    () => new WorktreeStatusStore((projectId, path) => rpc.call("worktreeStatus", { projectId, path })),
    [rpc],
  );
  return useMemo(() => ({ store, epoch }), [store, epoch]);
}

export function useWorktreeStatus(projectId: string, path: string | null, isVisible: boolean): WorktreeStatus | null {
  const context = useContext(StatusStoreContext);
  const status = useSyncExternalStore(
    context?.store.subscribe ?? noopSubscribe,
    () => (context && path ? context.store.get(path) : null),
  );
  useEffect(() => {
    if (context && path && isVisible) context.store.request(projectId, path, context.epoch);
  }, [context, projectId, path, isVisible]);
  return status;
}

const noopSubscribe = () => () => {};

export function useIsOnScreen<T extends Element>(): [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (node === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, visible];
}

const COLLAPSE_STORAGE_KEY = "bb-plugin-worktrees:collapsed";

function readCollapsed(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(COLLAPSE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function useCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      globalThis.localStorage?.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Storage full or disabled: collapse state just won't survive a reload.
    }
  }, [collapsed]);
  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const isCollapsed = useCallback((key: string) => collapsed.has(key), [collapsed]);
  return { isCollapsed, toggle };
}

export const collapseKey = {
  pinned: "pinned",
  personal: "personal",
  project: (projectId: string) => `project:${projectId}`,
  worktree: (projectId: string, key: string) => `worktree:${projectId}:${key}`,
  idleExpanded: (projectId: string) => `idle-expanded:${projectId}`,
  thread: (threadId: string) => `thread:${threadId}`,
};
