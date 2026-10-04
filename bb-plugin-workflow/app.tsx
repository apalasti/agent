// bb-plugin-workflow — the Workflow page: every effort's frontier tickets and
// every feature's open issues from the selected project's .scratch/, each one
// spawns a BB thread from the templates bundled with the plugin.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import type { WorkbenchIndex, ScratchIssue, ScratchTicket } from "./src/scratch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type SpawnInput =
  | { kind: "ref"; projectId: string; ref: string }
  | { kind: "chart"; projectId: string; idea: string }
  | { kind: "orchestrate"; projectId: string; feature: string; numbers: string[] };

function useWorkbench() {
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [index, setIndex] = useState<WorkbenchIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);

  const rescan = useCallback(
    (id: string) => {
      rpc.call("scan", { projectId: id }).then(
        (result) => {
          setIndex(result.index);
          setError(null);
        },
        (cause: unknown) => {
          setIndex(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    },
    [rpc],
  );

  useEffect(() => {
    rpc.call("projects").then((result) => {
      setProjects(result.projects);
      setProjectId((current) => current ?? result.projects[0]?.id ?? null);
    }, (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [rpc]);

  useEffect(() => {
    if (projectId !== null) rescan(projectId);
  }, [projectId, rescan]);

  const spawn = useCallback(
    async (input: SpawnInput) => {
      if (spawning) return;
      setSpawning(true);
      try {
        const spawned = await rpc.call("spawn", input);
        toast.success(`Spawned “${spawned.title}”`);
        rescan(input.projectId);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSpawning(false);
      }
    },
    [rpc, rescan, spawning],
  );

  return { projects, projectId, setProjectId, index, error, spawning, rescan, spawn };
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h2>;
}

function TicketRow({
  ticket,
  disabled,
  onRun,
}: {
  ticket: ScratchTicket;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          ticket.blocked && "text-muted-foreground",
        )}
      >
        <span className="font-mono text-xs text-muted-foreground">{ticket.number}</span>{" "}
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{ticket.type}</span>{" "}
        {ticket.title}
        {ticket.claimed !== null && (
          <span className="ml-2 text-xs text-muted-foreground">claimed {ticket.claimed}</span>
        )}
      </span>
      {ticket.status !== "closed" && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1"
          disabled={disabled}
          onClick={onRun}
          aria-label={`Run ticket "${ticket.title}"`}
        >
          <Icon name="Play" className="size-3.5" />
          Run
        </Button>
      )}
    </li>
  );
}

function IssuesCard({
  feature,
  issues,
  disabled,
  onRunOne,
  onRunBatch,
}: {
  feature: string;
  issues: ScratchIssue[];
  disabled: boolean;
  onRunOne: (number: string) => void;
  onRunBatch: (numbers: string[]) => void;
}) {
  const open = issues.filter((i) => i.status !== "done");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (number: string, on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(number);
      else next.delete(number);
      return next;
    });
  };
  if (open.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card px-4">
      <div className="flex items-center justify-between border-b border-border py-2.5">
        <SectionTitle>{feature} issues</SectionTitle>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1"
          disabled={disabled || selected.size === 0}
          onClick={() => onRunBatch([...selected].sort())}
        >
          <Icon name="ListPlay" className="size-3.5" />
          Orchestrate {selected.size > 0 ? `(${selected.size})` : ""}
        </Button>
      </div>
      <ul className="divide-y divide-border">
        {open.map((issue) => (
          <li key={issue.slug} className="flex items-center gap-3 py-2 text-sm">
            <Checkbox
              checked={selected.has(issue.number)}
              onCheckedChange={(checked) => toggle(issue.number, checked === true)}
              aria-label={`Select issue "${issue.title}"`}
            />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-mono text-xs text-muted-foreground">{issue.number}</span>{" "}
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{issue.status}</span>{" "}
              {issue.title}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1"
              disabled={disabled}
              onClick={() => onRunOne(issue.number)}
              aria-label={`Run issue "${issue.title}" solo`}
            >
              <Icon name="Play" className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartForm({
  disabled,
  onChart,
}: {
  disabled: boolean;
  onChart: (idea: string) => void;
}) {
  const [idea, setIdea] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = idea.trim();
    if (next === "") return;
    onChart(next);
    setIdea("");
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        value={idea}
        onChange={(event) => setIdea(event.target.value)}
        placeholder="＋ Chart a new map from a loose idea…"
        aria-label="Idea to chart"
      />
      <Button type="submit" disabled={disabled || idea.trim() === ""}>
        <Icon name="Map" className="size-4" />
        Chart
      </Button>
    </form>
  );
}

function WorkflowPage() {
  const { projects, projectId, setProjectId, index, error, spawning, rescan, spawn } = useWorkbench();
  const [showBlocked, setShowBlocked] = useState(false);

  const effortCards = useMemo(
    () =>
      index?.efforts.map((effort) => ({
        ...effort,
        frontier: effort.tickets.filter((t) => t.status !== "closed" && !t.blocked),
        blocked: effort.tickets.filter((t) => t.status !== "closed" && t.blocked),
      })) ?? [],
    [index],
  );

  const isEmpty =
    index !== null &&
    index.efforts.length === 0 &&
    index.features.every((f) => f.issues.every((i) => i.status === "done"));

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl space-y-4 p-4 md:p-5">
        <div className="flex items-center gap-2">
          <select
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
            value={projectId ?? ""}
            onChange={(event) => setProjectId(event.target.value)}
            aria-label="Project"
          >
            {projects === null ? <option value="">Loading projects…</option> : null}
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            disabled={projectId === null || spawning}
            onClick={() => projectId !== null && rescan(projectId)}
            aria-label="Rescan .scratch"
          >
            <Icon name="RefreshCw" className="size-4" />
          </Button>
        </div>

        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {projectId !== null && index !== null && (
          <>
            {effortCards.map((effort) => (
              <div key={effort.slug} className="overflow-hidden rounded-lg border border-border bg-card px-4">
                <div className="flex items-center justify-between border-b border-border py-2.5">
                  <SectionTitle>{effort.slug}</SectionTitle>
                  {effort.frontier.length === 0 && effort.blocked.length === 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1"
                      disabled={spawning}
                      onClick={() =>
                        spawn({ kind: "ref", projectId, ref: `${effort.slug}/handoff` })
                      }
                    >
                      <Icon name="Flag" className="size-3.5" />
                      Hand off to to-prd
                    </Button>
                  )}
                </div>
                <ul className="divide-y divide-border">
                  {effort.frontier.map((ticket) => (
                    <TicketRow
                      key={ticket.slug}
                      ticket={ticket}
                      disabled={spawning}
                      onRun={() =>
                        spawn({ kind: "ref", projectId, ref: `${effort.slug}/tickets/${ticket.number}` })
                      }
                    />
                  ))}
                </ul>
                {effort.blocked.length > 0 && (
                  <div className="py-2">
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowBlocked((v) => !v)}
                    >
                      {showBlocked ? "Hide" : "Show"} {effort.blocked.length} blocked
                    </button>
                    {showBlocked && (
                      <ul className="divide-y divide-border">
                        {effort.blocked.map((ticket) => (
                          <TicketRow
                            key={ticket.slug}
                            ticket={ticket}
                            disabled
                            onRun={() => {}}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))}

            {index.features.map((feature) => (
              <IssuesCard
                key={feature.slug}
                feature={feature.slug}
                issues={feature.issues}
                disabled={spawning}
                onRunOne={(number) =>
                  spawn({ kind: "ref", projectId, ref: `${feature.slug}/issues/${number}` })
                }
                onRunBatch={(numbers) =>
                  spawn({ kind: "orchestrate", projectId, feature: feature.slug, numbers })
                }
              />
            ))}

            {isEmpty && (
              <EmptyState>
                No open tickets or issues in this project's <code>.scratch/</code> — chart a new map below.
              </EmptyState>
            )}

            <ChartForm
              disabled={spawning}
              onChart={(idea) => spawn({ kind: "chart", projectId, idea })}
            />

            <p className="text-xs text-muted-foreground">
              Agents do the same from a shell: <code>bb workflow tickets</code>,{" "}
              <code>bb workflow run {"<slug>/<NN>"}</code>,{" "}
              <code>bb workflow orchestrate {"<feature> \"01 03\""}</code>.
            </p>
          </>
        )}

        {projectId !== null && index === null && error === null && (
          <EmptyState>Reading .scratch/…</EmptyState>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "workflow",
    title: "Workflow",
    icon: "Map",
    path: "workflow",
    component: WorkflowPage,
  });
});
