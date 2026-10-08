import { useCallback, useMemo, useState } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { groupSidebar, rollupIndicator, type WorktreeNode } from "../group";
import { collapseKey, PathStoresContext, useCollapsed, usePathStores, useProjectWorktrees, useRefreshEpoch } from "./data";
import { RollupGlyph } from "./glyphs";
import { NewTaskDialog } from "./NewTaskDialog";
import { NewThreadInWorktreeDialog } from "./NewThreadInWorktreeDialog";
import { ProjectSettingsDialog } from "./ProjectSettings";
import { RemoveWorktreeDialog } from "./RemoveWorktreeDialog";
import { GroupHeader, IdleWorktreesRow, ListContext, ProjectRow, ThreadRow, WorktreeRow, type ListContextValue } from "./rows";

type OpenDialog =
  | { kind: "new-task"; projectId: string }
  | { kind: "new-thread"; projectId: string; group: WorktreeNode }
  | { kind: "remove"; projectId: string; group: WorktreeNode }
  | { kind: "settings"; projectId: string };

export function WorktreeList({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const { status, threads, projects } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const { isCollapsed, toggle } = useCollapsed();
  const [manualEpoch, setManualEpoch] = useState(0);
  const epoch = useRefreshEpoch() + manualEpoch;
  const [dialog, setDialog] = useState<OpenDialog | null>(null);

  const expandedProjectIds = useMemo(
    () => projects.filter((p) => !p.isPersonal && !isCollapsed(collapseKey.project(p.id))).map((p) => p.id),
    [projects, isCollapsed],
  );
  const { worktrees, errors } = useProjectWorktrees(expandedProjectIds, epoch);
  const pathStores = usePathStores(epoch);
  const tree = useMemo(() => groupSidebar(threads, projects, worktrees), [threads, projects, worktrees]);
  const personalProject = projects.find((project) => project.isPersonal);

  const openNewThreadIn = useCallback(
    (projectId: string, group: WorktreeNode) => {
      if (group.liveEnvironmentId !== null) {
        actions.openNewThread({ projectId, environmentId: group.liveEnvironmentId, focusPrompt: true });
        onNavigate();
      } else if (group.path !== null) {
        setDialog({ kind: "new-thread", projectId, group });
      } else {
        actions.openNewThread({ projectId, focusPrompt: true });
        onNavigate();
      }
    },
    [actions, onNavigate],
  );

  const list: ListContextValue = useMemo(
    () => ({
      activeThreadId,
      onNavigate,
      isCollapsed,
      toggle,
      openNewTask: (projectId) => setDialog({ kind: "new-task", projectId }),
      openNewThreadIn,
      openRemove: (projectId, group) => setDialog({ kind: "remove", projectId, group }),
      openSettings: (projectId) => setDialog({ kind: "settings", projectId }),
      refresh: () => setManualEpoch((value) => value + 1),
    }),
    [activeThreadId, onNavigate, isCollapsed, toggle, openNewThreadIn],
  );

  const closeDialog = useCallback(() => setDialog(null), []);
  const projectName = (projectId: string) => projects.find((p) => p.id === projectId)?.name ?? projectId;

  return (
    <ListContext.Provider value={list}>
      <PathStoresContext.Provider value={pathStores}>
        <TooltipProvider>
          <nav aria-label="Threads by worktree" className="flex flex-col gap-px px-2 pb-3">
            {status === "loading" && threads.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading threads…</p>
            ) : null}
            {status === "error" ? (
              <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
                Couldn't load threads.
              </p>
            ) : null}

            {tree.pinned.length > 0 ? (
              <section aria-label="Pinned" className="flex flex-col gap-px">
                <GroupHeader
                  label="Pinned"
                  collapsed={isCollapsed(collapseKey.pinned)}
                  onToggle={() => toggle(collapseKey.pinned)}
                  passive={isCollapsed(collapseKey.pinned) ? <RollupGlyph rollup={rollupIndicator(tree.pinned)} /> : null}
                />
                {isCollapsed(collapseKey.pinned)
                  ? null
                  : tree.pinned.map((node) => <ThreadRow key={node.thread.id} node={node} depth={0} />)}
              </section>
            ) : null}

            {tree.projects.map((projectNode) => {
              const projectId = projectNode.project.id;
              const projectCollapsed = isCollapsed(collapseKey.project(projectId));
              const idleKey = collapseKey.idleExpanded(projectId);
              const idleCollapsed = !isCollapsed(idleKey);
              return (
                <section key={projectId} aria-label={projectNode.project.name} className="mt-2 flex flex-col gap-px first:mt-0">
                  <ProjectRow node={projectNode} />
                  {projectCollapsed ? null : (
                    <>
                      {errors[projectId] ? (
                        <p className="truncate px-2 text-xs text-destructive/80" title={errors[projectId]}>
                          Couldn't list worktrees: {errors[projectId]}
                        </p>
                      ) : null}
                      {projectNode.worktrees.length === 0 &&
                      projectNode.idleWorktrees.length === 0 &&
                      projectNode.worktreesLoaded &&
                      !errors[projectId] ? (
                        <p className="px-2 py-1 text-xs text-muted-foreground">No worktrees</p>
                      ) : null}
                      {projectNode.worktrees.map((group) => (
                        <div key={group.key} className="flex flex-col gap-px">
                          <WorktreeRow projectId={projectId} group={group} />
                          {isCollapsed(collapseKey.worktree(projectId, group.key))
                            ? null
                            : group.threads.map((node) => <ThreadRow key={node.thread.id} node={node} depth={1} />)}
                        </div>
                      ))}
                      {projectNode.idleWorktrees.length > 0 ? (
                        <>
                          <IdleWorktreesRow
                            count={projectNode.idleWorktrees.length}
                            collapsed={idleCollapsed}
                            onToggle={() => toggle(idleKey)}
                          />
                          {idleCollapsed
                            ? null
                            : projectNode.idleWorktrees.map((group) => (
                                <WorktreeRow key={group.key} projectId={projectId} group={group} depth={1} />
                              ))}
                        </>
                      ) : null}
                    </>
                  )}
                </section>
              );
            })}

            {tree.personal.length > 0 ? (
              <section aria-label={personalProject?.name ?? "Personal"} className="mt-2 flex flex-col gap-px">
                <GroupHeader
                  label={personalProject?.name ?? "Personal"}
                  collapsed={isCollapsed(collapseKey.personal)}
                  onToggle={() => toggle(collapseKey.personal)}
                  passive={isCollapsed(collapseKey.personal) ? <RollupGlyph rollup={rollupIndicator(tree.personal)} /> : null}
                />
                {isCollapsed(collapseKey.personal)
                  ? null
                  : tree.personal.map((node) => <ThreadRow key={node.thread.id} node={node} depth={0} />)}
              </section>
            ) : null}
          </nav>
        </TooltipProvider>

        {dialog?.kind === "new-task" ? (
          <NewTaskDialog projectId={dialog.projectId} projectName={projectName(dialog.projectId)} onClose={closeDialog} onNavigate={onNavigate} />
        ) : null}
        {dialog?.kind === "new-thread" ? (
          <NewThreadInWorktreeDialog projectId={dialog.projectId} group={dialog.group} onClose={closeDialog} onNavigate={onNavigate} />
        ) : null}
        {dialog?.kind === "remove" ? (
          <RemoveWorktreeDialog
            projectId={dialog.projectId}
            group={dialog.group}
            activeThreadId={activeThreadId}
            onClose={closeDialog}
          />
        ) : null}
        {dialog?.kind === "settings" ? (
          <ProjectSettingsDialog projectId={dialog.projectId} projectName={projectName(dialog.projectId)} onClose={closeDialog} />
        ) : null}
      </PathStoresContext.Provider>
    </ListContext.Provider>
  );
}
