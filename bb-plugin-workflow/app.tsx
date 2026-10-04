// bb-plugin-workflow — two surfaces over the same scan of a project's
// .scratch/, scoped per worktree: the sidebar Workflow page (every checkout
// of a project, its frontier tickets and open issues) and a right-rail thread
// panel (the current thread's checkout only). Every Run spawns a BB thread
// into the owning checkout so bb's sidebar groups it under that worktree.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginEnvironmentProviderInputsProps,
  type PluginNewThreadPanelProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract, WorkflowSection, WorkflowWorktree } from "./server";
import type { ScratchIssue, ScratchTicket } from "./src/scratch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
interface SpawnTarget {
  path: string;
  hostId?: string;
  environmentId?: string | null;
}
type SpawnInput =
  | { kind: "ref"; projectId: string; ref: string; target?: SpawnTarget }
  | { kind: "chart"; projectId: string; idea: string; target?: SpawnTarget }
  | {
      kind: "orchestrate";
      projectId: string;
      feature: string;
      numbers: string[];
      target?: SpawnTarget;
    };

const targetOf = (worktree: WorkflowWorktree): SpawnTarget => ({
  path: worktree.path,
  hostId: worktree.hostId,
  environmentId: worktree.environmentId,
});

function useSpawner(rpc: Rpc, refresh: () => void) {
  const [spawning, setSpawning] = useState(false);
  const spawn = useCallback(
    async (input: SpawnInput) => {
      if (spawning) return;
      setSpawning(true);
      try {
        const spawned = await rpc.call("spawn", input as never);
        toast.success(`Spawned “${spawned.title}”`);
        refresh();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSpawning(false);
      }
    },
    [rpc, refresh, spawning],
  );
  return { spawning, spawn };
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

function TicketRow({
  ticket,
  disabled,
  onRun,
  compact,
}: {
  ticket: ScratchTicket;
  disabled: boolean;
  onRun: () => void;
  compact?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span className={cn("min-w-0 flex-1 truncate", ticket.blocked && "text-muted-foreground")}>
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
          {compact ? null : "Run"}
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
  titlePrefix,
}: {
  feature: string;
  issues: ScratchIssue[];
  disabled: boolean;
  onRunOne: (number: string) => void;
  onRunBatch: (numbers: string[]) => void;
  titlePrefix?: string;
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
        <SectionTitle>
          {titlePrefix}
          {feature} issues
        </SectionTitle>
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
  placeholder,
}: {
  disabled: boolean;
  onChart: (idea: string) => void;
  placeholder?: string;
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
        placeholder={placeholder ?? "＋ Chart a new map from a loose idea…"}
        aria-label="Idea to chart"
      />
      <Button type="submit" disabled={disabled || idea.trim() === ""}>
        <Icon name="Map" className="size-4" />
        Chart
      </Button>
    </form>
  );
}

function EffortCard({
  effort,
  disabled,
  onRunTicket,
  onHandoff,
}: {
  effort: { slug: string; tickets: ScratchTicket[] };
  disabled: boolean;
  onRunTicket: (ticket: ScratchTicket) => void;
  onHandoff: () => void;
}) {
  const [showBlocked, setShowBlocked] = useState(false);
  const frontier = useMemo(
    () => effort.tickets.filter((t) => t.status !== "closed" && !t.blocked),
    [effort.tickets],
  );
  const blocked = useMemo(
    () => effort.tickets.filter((t) => t.status !== "closed" && t.blocked),
    [effort.tickets],
  );
  const exhausted = frontier.length === 0 && blocked.length === 0;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card px-4">
      <div className="flex items-center justify-between border-b border-border py-2.5">
        <SectionTitle>{effort.slug}</SectionTitle>
        {exhausted && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1"
            disabled={disabled}
            onClick={onHandoff}
          >
            <Icon name="Flag" className="size-3.5" />
            Hand off to to-prd
          </Button>
        )}
      </div>
      <ul className="divide-y divide-border">
        {frontier.map((ticket) => (
          <TicketRow
            key={ticket.slug}
            ticket={ticket}
            disabled={disabled}
            onRun={() => onRunTicket(ticket)}
          />
        ))}
      </ul>
      {blocked.length > 0 && (
        <div className="py-2">
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowBlocked((v) => !v)}
          >
            {showBlocked ? "Hide" : "Show"} {blocked.length} blocked
          </button>
          {showBlocked && (
            <ul className="divide-y divide-border">
              {blocked.map((ticket) => (
                <TicketRow key={ticket.slug} ticket={ticket} disabled onRun={() => {}} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SectionBody({
  section,
  projectId,
  disabled,
  spawn,
  compact,
}: {
  section: WorkflowSection;
  projectId: string;
  disabled: boolean;
  spawn: (input: SpawnInput) => void;
  compact?: boolean;
}) {
  const target = targetOf(section.worktree);
  const index = section.index;
  if (index === null) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        No <code>.scratch/</code> here yet.
        <div className="mt-2">
          <ChartForm
            disabled={disabled}
            placeholder="Chart a new map in this checkout…"
            onChart={(idea) => spawn({ kind: "chart", projectId, idea, target })}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3 px-4 py-3">
      {index.efforts.map((effort) => (
        <EffortCard
          key={effort.slug}
          effort={effort}
          disabled={disabled}
          onRunTicket={(ticket) =>
            spawn({
              kind: "ref",
              projectId,
              ref: `${effort.slug}/tickets/${ticket.number}`,
              target,
            })
          }
          onHandoff={() => spawn({ kind: "ref", projectId, ref: `${effort.slug}/handoff`, target })}
        />
      ))}
      {index.features.map((feature) => (
        <IssuesCard
          key={feature.slug}
          feature={feature.slug}
          issues={feature.issues}
          disabled={disabled}
          onRunOne={(number) =>
            spawn({ kind: "ref", projectId, ref: `${feature.slug}/issues/${number}`, target })
          }
          onRunBatch={(numbers) =>
            spawn({ kind: "orchestrate", projectId, feature: feature.slug, numbers, target })
          }
        />
      ))}
      <ChartForm
        disabled={disabled}
        onChart={(idea) => spawn({ kind: "chart", projectId, idea, target })}
      />
    </div>
  );
}

function WorktreeHeader({ worktree }: { worktree: WorkflowWorktree }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
      <Icon
        name={worktree.isPrimary ? "Home" : "GitBranch"}
        className="size-3.5 text-muted-foreground"
      />
      <span className="truncate text-sm font-medium">
        {worktree.isPrimary ? "Primary checkout" : (worktree.branch ?? "worktree")}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {worktree.path}
      </span>
      {worktree.environmentId === null && (
        <span
          className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
          title="No BB environment attached yet; the first run here creates one, and the thread groups under this worktree."
        >
          no threads yet
        </span>
      )}
    </div>
  );
}

function WorkflowPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sections, setSections] = useState<WorkflowSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rescan = useCallback(
    (id: string) => {
      rpc.call("scan", { projectId: id }).then(
        (result) => {
          setSections(result.sections);
          setError(null);
        },
        (cause: unknown) => {
          setSections(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    },
    [rpc],
  );

  useEffect(() => {
    rpc.call("projects").then(
      (result) => {
        setProjects(result.projects);
        setProjectId((current) => current ?? result.projects[0]?.id ?? null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc]);

  useEffect(() => {
    if (projectId !== null) rescan(projectId);
  }, [projectId, rescan]);

  const { spawning, spawn } = useSpawner(rpc, () => {
    if (projectId !== null) rescan(projectId);
  });

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

        {projectId !== null &&
          sections !== null &&
          (sections.length === 0 ? (
            <EmptyState>This project has no local checkout.</EmptyState>
          ) : (
            sections.map((section) => (
              <section
                key={section.worktree.path}
                className="overflow-hidden rounded-xl border border-border bg-background"
              >
                <WorktreeHeader worktree={section.worktree} />
                <SectionBody
                  section={section}
                  projectId={projectId}
                  disabled={spawning}
                  spawn={spawn}
                />
              </section>
            ))
          ))}

        {projectId !== null && sections === null && error === null && (
          <EmptyState>Reading .scratch/…</EmptyState>
        )}

        <p className="text-xs text-muted-foreground">
          Agents do the same from a shell: <code>bb workflow tickets</code>,{" "}
          <code>bb workflow run {"<slug>/<NN>"}</code>,{" "}
          <code>bb workflow orchestrate {"<feature> \"01 03\""}</code>, all with{" "}
          <code>--worktree</code> to pick a checkout.
        </p>
      </div>
    </div>
  );
}

function WorkflowPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [result, setResult] = useState<{
    projectId: string;
    section: WorkflowSection | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    rpc.call("scanThread", { threadId }).then(
      (value) => {
        setResult(value);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc, threadId]);

  useEffect(refresh, [refresh]);

  const { spawning, spawn } = useSpawner(rpc, refresh);

  if (error !== null) {
    return (
      <p role="alert" className="p-3 text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (result === null) {
    return <p className="p-3 text-sm text-muted-foreground">Reading .scratch/…</p>;
  }
  if (result.section === null) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        This thread has no checkout, so there is no .scratch/ to show.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            name={result.section.worktree.isPrimary ? "Home" : "GitBranch"}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="truncate text-sm font-medium">
            {result.section.worktree.isPrimary
              ? "Primary checkout"
              : (result.section.worktree.branch ?? "worktree")}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={spawning}
          onClick={refresh}
          aria-label="Rescan"
        >
          <Icon name="RefreshCw" className="size-3.5" />
        </Button>
      </div>
      {result.section.index === null ? (
        <div className="text-sm text-muted-foreground">
          No <code>.scratch/</code> in this checkout yet.
          <div className="mt-2">
            <ChartForm
              disabled={spawning}
              placeholder="Chart a new map here…"
              onChart={(idea) =>
                spawn({
                  kind: "chart",
                  projectId: result.projectId,
                  idea,
                  target: targetOf(result.section!.worktree),
                })
              }
            />
          </div>
        </div>
      ) : (
        <>
          {result.section.index.efforts.map((effort) => (
            <EffortCard
              key={effort.slug}
              effort={effort}
              disabled={spawning}
              onRunTicket={(ticket) =>
                spawn({
                  kind: "ref",
                  projectId: result.projectId,
                  ref: `${effort.slug}/tickets/${ticket.number}`,
                  target: targetOf(result.section!.worktree),
                })
              }
              onHandoff={() =>
                spawn({
                  kind: "ref",
                  projectId: result.projectId,
                  ref: `${effort.slug}/handoff`,
                  target: targetOf(result.section!.worktree),
                })
              }
            />
          ))}
          {result.section.index.features.map((feature) => (
            <IssuesCard
              key={feature.slug}
              feature={feature.slug}
              issues={feature.issues}
              disabled={spawning}
              onRunOne={(number) =>
                spawn({
                  kind: "ref",
                  projectId: result.projectId,
                  ref: `${feature.slug}/issues/${number}`,
                  target: targetOf(result.section!.worktree),
                })
              }
              onRunBatch={(numbers) =>
                spawn({
                  kind: "orchestrate",
                  projectId: result.projectId,
                  feature: feature.slug,
                  numbers,
                  target: targetOf(result.section!.worktree),
                })
              }
            />
          ))}
          <ChartForm
            disabled={spawning}
            placeholder="Chart a new map here…"
            onChart={(idea) =>
              spawn({
                kind: "chart",
                projectId: result.projectId,
                idea,
                target: targetOf(result.section!.worktree),
              })
            }
          />
        </>
      )}
    </div>
  );
}

function ExistingCheckoutInputs({
  projectId,
  target,
  value,
  onChange,
}: PluginEnvironmentProviderInputsProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [worktrees, setWorktrees] = useState<WorkflowWorktree[] | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customPath, setCustomPath] = useState("");
  const selectedPath = (value as { path?: string } | null)?.path ?? "";

  useEffect(() => {
    if (projectId === null) {
      setWorktrees([]);
      return;
    }
    rpc.call("scan", { projectId }).then(
      (result) => setWorktrees(result.sections.map((s) => s.worktree)),
      () => setWorktrees([]),
    );
  }, [rpc, projectId]);

  useEffect(() => {
    if (selectedPath === "") {
      onChange({ status: "blocked", reason: "Pick a checkout" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const options = (worktrees ?? []).filter(
    (w) =>
      target.kind !== "existing-host" || w.hostId === undefined || w.hostId === target.hostId,
  );

  if (customOpen || options.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={customPath}
          onChange={(event) => {
            const path = event.target.value;
            setCustomPath(path);
            if (path.trim() === "") {
              onChange({ status: "blocked", reason: "Enter an absolute path" });
            } else {
              onChange({ status: "ready", value: { path: path.trim() } });
            }
          }}
          placeholder="/absolute/path/to/checkout"
          aria-label="Checkout path"
        />
        {options.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setCustomOpen(false)}>
            List
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        value={options.some((w) => w.path === selectedPath) ? selectedPath : ""}
        onChange={(event) => {
          const path = event.target.value;
          if (path === "") {
            onChange({ status: "blocked", reason: "Pick a checkout" });
          } else {
            onChange({ status: "ready", value: { path } });
          }
        }}
        aria-label="Checkout"
      >
        <option value="" disabled>
          Pick a checkout…
        </option>
        {options.map((w) => (
          <option key={w.path} value={w.path}>
            {w.isPrimary ? "Primary" : (w.branch ?? w.path)}
            {w.isPrimary ? "" : ` — ${w.path}`}
          </option>
        ))}
      </select>
      <Button variant="ghost" size="sm" onClick={() => setCustomOpen(true)} aria-label="Enter a path">
        Custom
      </Button>
    </div>
  );
}

function WorktreeSpawnPanel({ projectId }: PluginNewThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [sections, setSections] = useState<WorkflowSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busyPath, setBusyPath] = useState<string | null>(null);

  useEffect(() => {
    if (projectId === null) return;
    rpc.call("scan", { projectId }).then(
      (result) => {
        setSections(result.sections);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc, projectId]);

  const spawnHere = async (worktree: WorkflowWorktree) => {
    if (projectId === null) return;
    const text = prompt.trim();
    if (text === "") {
      toast.error("Write a first message for the thread.");
      return;
    }
    setBusyPath(worktree.path);
    try {
      const spawned = await rpc.call("spawnHere", {
        projectId,
        prompt: text,
        target: targetOf(worktree),
      });
      toast.success(`Spawned “${spawned.title}”`);
      setPrompt("");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyPath(null);
    }
  };

  if (projectId === null) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        Pick a project in the composer first.
      </p>
    );
  }
  if (error !== null) {
    return (
      <p role="alert" className="p-3 text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (sections === null) {
    return <p className="p-3 text-sm text-muted-foreground">Finding checkouts…</p>;
  }
  return (
    <div className="space-y-3">
      <Input
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="First message for the new thread…"
        aria-label="First prompt"
      />
      <ul className="divide-y divide-border">
        {sections.map(({ worktree, index }) => {
          const tickets =
            index?.efforts.flatMap((e) => e.tickets.filter((t) => t.status !== "closed"))
              .length ?? 0;
          const issues =
            index?.features.flatMap((f) => f.issues.filter((i) => i.status !== "done")).length ??
            0;
          return (
            <li key={worktree.path} className="flex items-center gap-3 py-2">
              <Icon
                name={worktree.isPrimary ? "Home" : "GitBranch"}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {worktree.isPrimary ? "Primary checkout" : (worktree.branch ?? "worktree")}
                </span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {worktree.path}
                </span>
                {(tickets > 0 || issues > 0) && (
                  <span className="text-xs text-muted-foreground">
                    {tickets} open tickets · {issues} open issues
                  </span>
                )}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1"
                disabled={busyPath !== null}
                onClick={() => void spawnHere(worktree)}
                aria-label={`Spawn a thread in ${worktree.branch ?? worktree.path}`}
              >
                <Icon name="Play" className="size-3.5" />
                Spawn here
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        The thread attaches to that checkout as an unmanaged environment — from then on it
        appears under “Reuse an existing environment” and its own sidebar group.
      </p>
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

  app.slots.threadPanelAction({
    id: "workflow-panel",
    title: "Workflow",
    icon: "Map",
    component: WorkflowPanel,
    layout: "padded",
  });

  app.slots.experimental_newThreadPanelAction({
    id: "spawn-in-worktree",
    title: "Spawn into worktree",
    icon: "GitBranch",
    component: WorktreeSpawnPanel,
    layout: "padded",
  });

  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: "existing-checkout",
    component: ExistingCheckoutInputs,
  });

  // Sidebar row badges for plugin-spawned threads (ticket in progress ✚,
  // orchestration x/y done…). Data comes from the server over the plugin's own
  // RPC route; same-origin fetch carries the app session.
  app.contentScripts.register({
    id: "workflow-row-status",
    mount({ experimental_setThreadRowStatus: setStatus, signal }) {
      if (!setStatus) return;
      const applied = new Map<string, string>();
      const refresh = async () => {
        if (signal.aborted) return;
        try {
          const response = await fetch("/api/v1/plugins/workflow/rpc/rowStatuses", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "null",
            signal,
          });
          if (!response.ok) return;
          const body = (await response.json()) as {
            statuses?: Record<string, { icon: string; label: string; tone?: string }>;
          };
          const statuses = body?.statuses ?? {};
          for (const [threadId, status] of Object.entries(statuses)) {
            const key = JSON.stringify(status);
            if (applied.get(threadId) !== key) {
              setStatus(threadId, status as never);
              applied.set(threadId, key);
            }
          }
          for (const threadId of [...applied.keys()]) {
            if (!(threadId in statuses)) {
              setStatus(threadId, null);
              applied.delete(threadId);
            }
          }
        } catch {
          // Poll again next tick; a badge is not worth an error surface.
        }
      };
      const timer = setInterval(refresh, 45_000);
      const onFocus = () => void refresh();
      window.addEventListener("focus", onFocus, { signal });
      const kickoff = setTimeout(() => void refresh(), 1_500);
      return () => {
        clearInterval(timer);
        clearTimeout(kickoff);
        for (const threadId of applied.keys()) setStatus(threadId, null);
      };
    },
  });
});
