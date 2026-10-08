import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import {
  WORKTREES_CHANGED,
  type AgentDefaults,
  type rpcContract,
  type ScratchSummary,
  type ScratchView,
  type Worktree,
  type WorktreeStatus,
} from "../contract";

export const REFRESH_INTERVAL_MS = 30_000;
export const SCRATCH_POLL_MS = 5_000;

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

type PathEntry<T> = { value: T | null; epoch: number; inFlight: boolean };

/** Caches one backend answer per worktree path; a row asks only while it is on screen. */
export class PathStore<T> {
  private entries = new Map<string, PathEntry<T>>();
  private listeners = new Set<() => void>();

  constructor(private readonly fetchValue: (projectId: string, path: string) => Promise<T>) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  get(path: string): T | null {
    return this.entries.get(path)?.value ?? null;
  }

  request(projectId: string, path: string, epoch: number): void {
    const entry = this.entries.get(path);
    if (entry !== undefined && (entry.inFlight || entry.epoch >= epoch)) return;
    this.entries.set(path, { value: entry?.value ?? null, epoch, inFlight: true });
    this.fetchValue(projectId, path).then(
      (value) => this.settle(path, epoch, value),
      () => this.settle(path, epoch, entry?.value ?? null),
    );
  }

  private settle(path: string, epoch: number, value: T | null) {
    this.entries.set(path, { value, epoch, inFlight: false });
    for (const listener of this.listeners) listener();
  }
}

export type PathStores = {
  status: PathStore<WorktreeStatus>;
  scratch: PathStore<ScratchSummary>;
  epoch: number;
};

export const PathStoresContext = createContext<PathStores | null>(null);

export function usePathStores(epoch: number): PathStores {
  const rpc = useWorktreesRpc();
  const stores = useMemo(
    () => ({
      status: new PathStore((projectId, path) => rpc.call("worktreeStatus", { projectId, path })),
      scratch: new PathStore((projectId, path) => rpc.call("scratchSummary", { projectId, path })),
    }),
    [rpc],
  );
  return useMemo(() => ({ ...stores, epoch }), [stores, epoch]);
}

function usePathValue<T>(
  pick: (stores: PathStores) => PathStore<T>,
  projectId: string,
  path: string | null,
  isVisible: boolean,
): T | null {
  const context = useContext(PathStoresContext);
  const store = context ? pick(context) : null;
  const value = useSyncExternalStore(store?.subscribe ?? noopSubscribe, () => (store && path ? store.get(path) : null));
  useEffect(() => {
    if (context && store && path && isVisible) store.request(projectId, path, context.epoch);
  }, [context, store, projectId, path, isVisible]);
  return value;
}

export function useWorktreeStatus(projectId: string, path: string | null, isVisible: boolean): WorktreeStatus | null {
  return usePathValue((stores) => stores.status, projectId, path, isVisible);
}

export function useScratchSummary(projectId: string, path: string | null, isVisible: boolean): ScratchSummary | null {
  return usePathValue((stores) => stores.scratch, projectId, path, isVisible);
}

export function useScratchView(projectId: string, path: string): { view: ScratchView | null; error: string | null; reload: () => void } {
  const rpc = useWorktreesRpc();
  const epoch = useRefreshEpoch();
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ view: ScratchView | null; error: string | null }>({ view: null, error: null });
  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    const timer = setInterval(reload, SCRATCH_POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    rpc.call("scratch", { projectId, path }).then(
      (view) => !cancelled && setState({ view, error: null }),
      (cause: unknown) => !cancelled && setState((prev) => ({ ...prev, error: errorMessage(cause) })),
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, path, epoch, tick]);

  return { ...state, reload };
}

/** `loaded` turns true once the backend answered, so a composer can mount with its seed already in place. */
export function useAgentDefaults(projectId: string, prefer?: string): { loaded: boolean; defaults: AgentDefaults | null } {
  const rpc = useWorktreesRpc();
  const [state, setState] = useState<{ loaded: boolean; defaults: AgentDefaults | null }>({ loaded: false, defaults: null });
  useEffect(() => {
    let cancelled = false;
    rpc.call("agentDefaults", { projectId, ...(prefer ? { prefer } : {}) }).then(
      (defaults) => !cancelled && setState({ loaded: true, defaults }),
      () => !cancelled && setState({ loaded: true, defaults: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, prefer]);
  return state;
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

const TASKS_EXPANDED_STORAGE_KEY = "bb-plugin-worktrees:tasks-expanded";

function readKeySet(storageKey: string): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

/** Each instance writes its whole set, so mount one per storage key. */
function useStoredKeySet(storageKey: string) {
  const [keys, setKeys] = useState(() => readKeySet(storageKey));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify([...keys]));
    } catch {
      // Storage full or disabled: the state just won't survive a reload.
    }
  }, [storageKey, keys]);
  const toggle = useCallback((key: string) => {
    setKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const has = useCallback((key: string) => keys.has(key), [keys]);
  return { has, toggle };
}

export function useCollapsed() {
  const { has, toggle } = useStoredKeySet(COLLAPSE_STORAGE_KEY);
  return { isCollapsed: has, toggle };
}

export function useTasksExpanded() {
  const { has, toggle } = useStoredKeySet(TASKS_EXPANDED_STORAGE_KEY);
  return { isExpanded: has, toggle };
}

export const collapseKey = {
  pinned: "pinned",
  personal: "personal",
  project: (projectId: string) => `project:${projectId}`,
  worktree: (projectId: string, key: string) => `worktree:${projectId}:${key}`,
  idleExpanded: (projectId: string) => `idle-expanded:${projectId}`,
  thread: (threadId: string) => `thread:${threadId}`,
};
