import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TASK_WORKTREE_PROVIDER_ID } from "./src/contract";
import { TASKS_PANEL_ACTION_ID, TasksHeaderButton } from "./src/ui/tasks/TasksHeaderButton";
import { TasksPanel } from "./src/ui/tasks/TasksPanel";
import { SettingsSection } from "./src/ui/ProjectSettings";
import { TaskWorktreeInputs } from "./src/ui/TaskWorktreeInputs";
import { WorktreeList } from "./src/ui/WorktreeList";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "worktrees",
    title: "Worktrees",
    description: "Projects, then their git worktrees, then the threads in each.",
    component: WorktreeList,
  });

  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: TASK_WORKTREE_PROVIDER_ID,
    component: TaskWorktreeInputs,
  });

  app.slots.threadPanelAction({ id: TASKS_PANEL_ACTION_ID, title: "Tasks", icon: "ListTodo", component: TasksPanel, layout: "flush" });
  app.slots.experimental_threadHeaderAction({ id: "tasks", title: "Tasks", component: TasksHeaderButton });

  app.slots.settingsSection({
    id: "projects",
    title: "Projects",
    description: "Per-project base ref, overlay, and setup/teardown commands for task worktrees.",
    component: SettingsSection,
  });
});
