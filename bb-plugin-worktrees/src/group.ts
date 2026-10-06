import type { PluginSidebarProject, PluginSidebarThread, PluginSidebarThreadRowStatus } from "@get-bb/plugin-sdk/app";
import type { Worktree } from "./contract";

export type ThreadNode = {
  thread: PluginSidebarThread;
  children: ThreadNode[];
};

export type WorktreeGroupKind = "worktree" | "unmatched" | "other";

export type WorktreeNode = {
  key: string;
  kind: WorktreeGroupKind;
  label: string;
  path: string | null;
  worktree: Worktree | null;
  threads: ThreadNode[];
  threadCount: number;
  lastActivity: number;
  /** An environment a live thread here already runs in, so "new thread here" can reuse it. */
  liveEnvironmentId: string | null;
};

export type ProjectNode = {
  project: PluginSidebarProject;
  worktreesLoaded: boolean;
  worktrees: WorktreeNode[];
  /** Thread-less worktrees other than the main checkout, folded into one trailing row. */
  idleWorktrees: WorktreeNode[];
  threadCount: number;
};

export type SidebarTree = {
  pinned: ThreadNode[];
  projects: ProjectNode[];
  personal: ThreadNode[];
};

export const OTHER_GROUP_KEY = "__other__";

export function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function baseName(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

export function worktreeLabel(worktree: Worktree): string {
  return worktree.branch ?? baseName(worktree.path);
}

export function isVisibleThread(thread: PluginSidebarThread): boolean {
  return !thread.isArchived && !thread.isHidden;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byCreatedDesc(a: PluginSidebarThread, b: PluginSidebarThread): number {
  return b.createdAt - a.createdAt || compareText(a.id, b.id);
}

/** bb's default "Updated at" order: active threads first, then by latest attention. */
export function compareThreads(a: PluginSidebarThread, b: PluginSidebarThread): number {
  const aActive = a.status === "active";
  const bActive = b.status === "active";
  if (aActive !== bActive) return aActive ? -1 : 1;
  if (aActive) return byCreatedDesc(a, b);
  return b.latestAttentionAt - a.latestAttentionAt || byCreatedDesc(a, b);
}

export function comparePinned(a: PluginSidebarThread, b: PluginSidebarThread): number {
  if (a.pinSortKey !== null && b.pinSortKey !== null) {
    const byKey = compareText(a.pinSortKey, b.pinSortKey);
    if (byKey !== 0) return byKey;
  }
  if ((a.pinSortKey === null) !== (b.pinSortKey === null)) return a.pinSortKey === null ? 1 : -1;
  return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || byCreatedDesc(a, b);
}

/** Nests visible threads under their visible parents; returns the roots with sorted children. */
export function buildThreadForest(threads: readonly PluginSidebarThread[]): ThreadNode[] {
  const nodes = new Map<string, ThreadNode>();
  for (const thread of threads) nodes.set(thread.id, { thread, children: [] });
  const roots: ThreadNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.thread.parentThreadId;
    const parent = parentId === null ? undefined : nodes.get(parentId);
    if (parent === undefined || createsCycle(node, parent, nodes)) roots.push(node);
    else parent.children.push(node);
  }
  const sortDeep = (list: ThreadNode[]) => {
    list.sort((a, b) => compareThreads(a.thread, b.thread));
    for (const child of list) sortDeep(child.children);
  };
  sortDeep(roots);
  return roots;
}

function createsCycle(node: ThreadNode, parent: ThreadNode, nodes: Map<string, ThreadNode>): boolean {
  const seen = new Set<string>([node.thread.id]);
  let cursor: ThreadNode | undefined = parent;
  while (cursor !== undefined) {
    if (seen.has(cursor.thread.id)) return true;
    seen.add(cursor.thread.id);
    const nextId: string | null = cursor.thread.parentThreadId;
    cursor = nextId === null ? undefined : nodes.get(nextId);
  }
  return false;
}

export function countThreads(nodes: readonly ThreadNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countThreads(node.children), 0);
}

export function flattenThreads(nodes: readonly ThreadNode[]): PluginSidebarThread[] {
  return nodes.flatMap((node) => [node.thread, ...flattenThreads(node.children)]);
}

export type Rollup = "unread-error" | "waiting-for-input" | "runtime" | "unread-success" | "none";

const ROLLUP_PRIORITY: readonly Rollup[] = ["unread-error", "waiting-for-input", "runtime", "unread-success", "none"];

function rollupOf(thread: PluginSidebarThread): Rollup {
  switch (thread.indicator) {
    case "unread-error":
    case "queued-failed":
      return "unread-error";
    case "waiting-for-input":
      return "waiting-for-input";
    case "runtime":
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
    case "working-draft":
      return "runtime";
    case "unread-success":
      return "unread-success";
    default:
      return "none";
  }
}

/** The one glyph a collapsed group shows for everything inside it. */
export function rollupIndicator(nodes: readonly ThreadNode[]): Rollup {
  let best = ROLLUP_PRIORITY.length - 1;
  for (const thread of flattenThreads(nodes)) best = Math.min(best, ROLLUP_PRIORITY.indexOf(rollupOf(thread)));
  return ROLLUP_PRIORITY[best]!;
}

/** Labels of the running row statuses (e.g. "2 subagents running") set on threads inside a group. */
export function runningStatusLabels(
  nodes: readonly ThreadNode[],
  statuses: ReadonlyMap<string, PluginSidebarThreadRowStatus>,
): string[] {
  return flattenThreads(nodes).flatMap((thread) => {
    const status = statuses.get(thread.id);
    return status?.tone === "running" ? [status.label] : [];
  });
}

function latestActivity(nodes: readonly ThreadNode[]): number {
  return flattenThreads(nodes).reduce((max, thread) => Math.max(max, thread.latestAttentionAt), 0);
}

function compareWorktreeGroups(a: WorktreeNode, b: WorktreeNode): number {
  const rank = (node: WorktreeNode) => (node.worktree?.isMain ? 0 : node.kind === "other" ? 2 : 1);
  return (
    rank(a) - rank(b) ||
    b.lastActivity - a.lastActivity ||
    compareText(a.label, b.label) ||
    compareText(a.key, b.key)
  );
}

function groupProject(
  project: PluginSidebarProject,
  roots: readonly ThreadNode[],
  worktrees: readonly Worktree[] | undefined,
): ProjectNode {
  const byPath = new Map<string, Worktree>();
  const byEnvironment = new Map<string, Worktree>();
  for (const worktree of worktrees ?? []) {
    byPath.set(normalizePath(worktree.path), worktree);
    for (const environmentId of worktree.environmentIds) byEnvironment.set(environmentId, worktree);
  }

  const groups = new Map<string, WorktreeNode>();
  const groupFor = (key: string, init: () => Omit<WorktreeNode, "threads" | "threadCount" | "lastActivity" | "liveEnvironmentId">) => {
    let group = groups.get(key);
    if (group === undefined) {
      group = { ...init(), threads: [], threadCount: 0, lastActivity: 0, liveEnvironmentId: null };
      groups.set(key, group);
    }
    return group;
  };
  const worktreeGroup = (worktree: Worktree) =>
    groupFor(normalizePath(worktree.path), () => ({
      key: normalizePath(worktree.path),
      kind: "worktree",
      label: worktreeLabel(worktree),
      path: normalizePath(worktree.path),
      worktree,
    }));

  for (const worktree of worktrees ?? []) worktreeGroup(worktree);

  for (const root of roots) {
    const environment = root.thread.environment;
    const path = environment?.path ? normalizePath(environment.path) : null;
    const matched =
      (path !== null ? byPath.get(path) : undefined) ??
      (environment?.id ? byEnvironment.get(environment.id) : undefined);
    const group =
      matched !== undefined
        ? worktreeGroup(matched)
        : path !== null
          ? groupFor(path, () => ({
              key: path,
              kind: "unmatched",
              label: environment?.branchName ?? baseName(path),
              path,
              worktree: null,
            }))
          : groupFor(OTHER_GROUP_KEY, () => ({
              key: OTHER_GROUP_KEY,
              kind: "other",
              label: "Other",
              path: null,
              worktree: null,
            }));
    group.threads.push(root);
  }

  const nodes = [...groups.values()].map((group) => {
    const threads = flattenThreads(group.threads);
    return {
      ...group,
      threadCount: threads.length,
      lastActivity: latestActivity(group.threads),
      liveEnvironmentId: threads.find((thread) => thread.environment?.id)?.environment?.id ?? null,
    };
  });
  nodes.sort(compareWorktreeGroups);
  const isIdle = (node: WorktreeNode) => node.kind === "worktree" && node.threadCount === 0 && !node.worktree?.isMain;
  return {
    project,
    worktreesLoaded: worktrees !== undefined,
    worktrees: nodes.filter((node) => !isIdle(node)),
    idleWorktrees: nodes.filter(isIdle),
    threadCount: nodes.reduce((sum, node) => sum + node.threadCount, 0),
  };
}

/** Pinned → projects → worktrees → threads; `worktreesByProject[id]` is undefined until listed. */
export function groupSidebar(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
  worktreesByProject: Readonly<Record<string, readonly Worktree[] | undefined>>,
): SidebarTree {
  const roots = buildThreadForest(threads.filter(isVisibleThread));
  const pinned = roots.filter((node) => node.thread.isPinned).sort((a, b) => comparePinned(a.thread, b.thread));
  const unpinned = roots.filter((node) => !node.thread.isPinned);

  const personalIds = new Set(projects.filter((project) => project.isPersonal).map((project) => project.id));
  const rootsByProject = new Map<string, ThreadNode[]>();
  for (const root of unpinned) {
    const list = rootsByProject.get(root.thread.projectId) ?? [];
    list.push(root);
    rootsByProject.set(root.thread.projectId, list);
  }

  const personal = [...personalIds].flatMap((id) => rootsByProject.get(id) ?? []);
  personal.sort((a, b) => compareThreads(a.thread, b.thread));

  return {
    pinned,
    projects: projects
      .filter((project) => !project.isPersonal)
      .map((project) => groupProject(project, rootsByProject.get(project.id) ?? [], worktreesByProject[project.id])),
    personal,
  };
}
