import { useEffect, useMemo, useState } from "react";
import { experimental_ProviderModelPicker as ProviderModelPicker, useBbNavigate, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { errorMessage, useScratchView, useTasksExpanded, useWorktreesRpc } from "../data";
import { ChartFooter } from "./ChartFooter";
import { EffortSection } from "./EffortSection";
import { effortModel, legend, liveThreadMap, type EffortModel, type TaskRow, type TaskState } from "./model";
import { STATE_DOT, STATE_LABEL } from "./tone";
import { needsPiWarning, useLaunch, type Modifiers } from "./useLaunch";

type Worktree = { projectId: string; path: string; label: string };
type Located = { status: "loading" } | { status: "outside" } | { status: "error"; message: string } | ({ status: "found" } & Worktree);

const LEGEND_ORDER: readonly TaskState[] = ["running", "ready", "blocked", "done"];

export function TasksPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useWorktreesRpc();
  const [located, setLocated] = useState<Located>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    rpc.call("threadWorktree", { threadId }).then(
      (result) => !cancelled && setLocated(result === null ? { status: "outside" } : { status: "found", ...result }),
      (cause: unknown) => !cancelled && setLocated({ status: "error", message: errorMessage(cause) }),
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId]);

  if (located.status === "found") return <WorktreeTasks key={`${located.projectId}:${located.path}`} {...located} />;
  if (located.status === "error") return <Alert message={located.message} />;
  return (
    <p className="p-4 text-sm text-muted-foreground">
      {located.status === "outside" ? "This thread isn't in a git worktree, so there is no .scratch to show." : "Reading .scratch…"}
    </p>
  );
}

function Alert({ message }: { message: string }) {
  return (
    <p role="alert" className="m-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
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
      <header className="border-b border-border px-3 py-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium">Tasks</h2>
          <span className="min-w-0 flex-1 truncate text-xs text-subtle-foreground" title={path}>
            {label}
          </span>
        </div>
        <div className="mt-1 flex gap-3 text-xs tabular-nums text-subtle-foreground">
          {LEGEND_ORDER.map((state) => (
            <span key={state} className="flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full", STATE_DOT[state])} aria-hidden="true" />
              {counts[state]} {STATE_LABEL[state].toLowerCase()}
            </span>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error !== null && view === null ? (
          <Alert message={error} />
        ) : view === null ? (
          <p className="p-4 text-xs text-muted-foreground">Reading .scratch…</p>
        ) : models.length === 0 ? (
          <p className="p-4 text-muted-foreground">No maps or issues in this worktree's .scratch yet.</p>
        ) : (
          <div className="grid divide-y divide-border">
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
          </div>
        )}
      </div>

      <footer className="grid gap-3 border-t border-border px-3 py-3">
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
      </footer>
    </div>
  );
}
