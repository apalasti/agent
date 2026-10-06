import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Worktree } from "../src/contract";

export function makeThread(
  id: string,
  overrides: Partial<Omit<PluginSidebarThread, "environment">> & {
    environment?: Partial<NonNullable<PluginSidebarThread["environment"]>> | null;
  } = {},
): PluginSidebarThread {
  const { environment, ...rest } = overrides;
  return {
    id,
    projectId: "p1",
    title: id,
    titleFallback: null,
    displayTitle: id,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/p1/threads/${id}`,
    isHidden: false,
    environment:
      environment === null
        ? null
        : {
            id: `env-${id}`,
            name: null,
            branchName: null,
            path: null,
            isWorktree: null,
            providerId: null,
            workspaceDisplayKind: null,
            ...environment,
          },
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    ...rest,
  } as PluginSidebarThread;
}

export function makeProject(id: string, overrides: Partial<PluginSidebarProject> = {}): PluginSidebarProject {
  return {
    id,
    name: id,
    isPersonal: false,
    href: `/projects/${id}`,
    settingsHref: `/projects/${id}/settings`,
    ...overrides,
  };
}

export function makeWorktree(path: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    path,
    branch: path.slice(path.lastIndexOf("/") + 1),
    head: "abc123",
    isMain: false,
    isDetached: false,
    isLocked: false,
    isPrunable: false,
    environmentIds: [],
    ...overrides,
  };
}
