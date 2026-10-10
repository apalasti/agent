import { useMemo } from "react";
import { experimental_ProviderModelPicker as ProviderModelPicker, useBbNavigate, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Mono, PanelBody, PanelFooter, PanelState, PanelToolbar, StatusDot } from "../../kit";
import { useScratchView, useTasksExpanded, useThreadWorktree, useWorktreesRpc } from "../data";
import { ChartFooter } from "./ChartFooter";
import { EffortSection } from "./EffortSection";
import { effortModel, legend, liveThreadMap, type EffortModel, type TaskRow, type TaskState } from "./model";
import { STATE_LABEL, STATE_STATUS } from "./tone";
import { needsPiWarning, useLaunch, type Modifiers } from "./useLaunch";

type Worktree = { projectId: string; path: string; label: string };

const LEGEND_ORDER: readonly TaskState[] = ["running", "ready", "blocked", "done"];

export function TasksPanel({ threadId }: PluginThreadPanelProps) {
  const located = useThreadWorktree(threadId);

  if (located.status === "found") return <WorktreeTasks key={`${located.projectId}:${located.path}`} {...located} />;
  if (located.status === "error") return <PanelState kind="error">{located.message}</PanelState>;
  if (located.status === "outside") {
    return <PanelState kind="empty">This thread isn't in a git worktree, so there is no .scratch to show.</PanelState>;
  }
  return <PanelState kind="loading">Reading .scratch…</PanelState>;
}

function WorktreeTasks({ projectId, path, label }: Worktree) {
  const rpc = useWorktreesRpc();
  const navigate = useBbNavigate();
  const { view, error, reload } = useScratchView(projectId, path);
  const { agent, setAgent, busy, launch } = useLaunch({ projectId, path }, reload);
  const { isExpanded, toggle } = useTasksExpanded();

  const models = useMemo(() => {
    const live = liveThreadMap(view);
    return view?.efforts.map((effort) => effortModel(effort, live)) ?? [];
  }, [view]);
  const counts = legend(models);
  const target = { projectId, path };

  const run = (row: TaskRow, event: Modifiers) =>
    launch(row.ref, row.ref, event, (agentRequest) => rpc.call("runTicket", { ...target, ref: row.ref, ...agentRequest }));
  const orchestrate = (model: EffortModel, event: Modifiers) => {
    const numbers = model.batch.open.map((issue) => issue.number);
    launch(`${model.slug}/orchestrate`, `${model.slug}/${numbers.join(", ")}`, event, (agentRequest) =>
      rpc.call("orchestrate", { ...target, effort: model.slug, issues: numbers, ...agentRequest }),
    );
  };
  const handoff = (slug: string, event: Modifiers) =>
    launch(`${slug}/handoff`, `${slug} handoff`, event, (agentRequest) => rpc.call("handoff", { ...target, effort: slug, ...agentRequest }));
  const chart = (idea: string, event: Modifiers) =>
    launch("chart", "charting", event, (agentRequest) => rpc.call("chart", { ...target, idea, ...agentRequest }));

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <PanelToolbar className="gap-2 px-3">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground" title={path}>
          <Icon name="GitBranch" className="size-3.5 shrink-0" aria-hidden="true" />
          <Mono className="min-w-0 truncate">{label}</Mono>
        </span>
        {models.length > 0 ? (
          <span className="flex shrink-0 gap-2 text-xs tabular-nums text-subtle-foreground">
            {LEGEND_ORDER.map((state) => (
              <span key={state} className="flex items-center gap-1">
                <StatusDot status={STATE_STATUS[state]} />
                {counts[state]} {STATE_LABEL[state].toLowerCase()}
              </span>
            ))}
          </span>
        ) : null}
      </PanelToolbar>

      <PanelBody>
        {error !== null && view === null ? (
          <PanelState kind="error" onRetry={reload}>
            {error}
          </PanelState>
        ) : view === null ? (
          <PanelState kind="loading">Reading .scratch…</PanelState>
        ) : models.length === 0 ? (
          <PanelState kind="empty">No maps or issues in this worktree's .scratch yet.</PanelState>
        ) : (
          <>
            {models.map((model) => (
              <EffortSection
                key={model.slug}
                model={model}
                busy={busy}
                doneExpanded={isExpanded(`done:${model.slug}`)}
                onToggleDone={() => toggle(`done:${model.slug}`)}
                onOpenThread={navigate.toThread}
                onRun={run}
                onOrchestrate={orchestrate}
                onHandoff={handoff}
              />
            ))}
          </>
        )}
      </PanelBody>

      <PanelFooter className="flex-col flex-nowrap items-stretch gap-3">
        <ChartFooter busy={busy} onChart={chart} />
        <div className="flex items-start justify-between gap-2">
          {agent !== null ? (
            <div className="grid gap-1">
              <ProviderModelPicker value={agent} onChange={setAgent} disabled={busy !== null} />
              {needsPiWarning(view, agent.providerId) ? (
                <p className="text-xs text-muted-foreground">Orchestration uses pi subagents; other providers can't run them.</p>
              ) : null}
            </div>
          ) : (
            <span />
          )}
          <span className="shrink-0 text-xs text-muted-foreground">⌘-click to start without leaving</span>
        </div>
      </PanelFooter>
    </div>
  );
}
