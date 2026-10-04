// bb-plugin-workflow — two surfaces over the same scan of a project's
// .scratch/, scoped per worktree: the sidebar Workflow page (every checkout
// of a project, its frontier tickets and open issues) and a right-rail thread
// panel (the current thread's checkout only). Every Run spawns a BB thread
// into the owning checkout so bb's sidebar groups it under that worktree.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  definePluginApp,
  useBbNavigate,
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
  | {
      kind: "manual";
      projectId: string;
      prompt: string;
      title?: string;
      target?: SpawnTarget;
      newWorktree?: boolean;
      open?: boolean;
    }
  | { kind: "ref"; projectId: string; ref: string; target?: SpawnTarget; open?: boolean }
  | { kind: "chart"; projectId: string; idea: string; target?: SpawnTarget; open?: boolean }
  | {
      kind: "orchestrate";
      projectId: string;
      feature: string;
      numbers: string[];
      target?: SpawnTarget;
      open?: boolean;
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

interface PickOption {
  key: string;
  label: string;
  sub?: string;
  icon?: string;
}

function Picker({
  options,
  value,
  onSelect,
  placeholder,
  filterPlaceholder,
  footer,
  disabled,
}: {
  options: PickOption[];
  value: string | null;
  onSelect: (key: string) => void;
  placeholder: string;
  filterPlaceholder?: string;
  footer?: ReactNode;
  disabled?: boolean;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const selected = options.find((o) => o.key === value);
  const needle = filter.trim().toLowerCase();
  const filtered = options.filter(
    (o) => needle === "" || o.label.toLowerCase().includes(needle) || (o.sub ?? "").toLowerCase().includes(needle),
  );
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={listOpen}
        onClick={() => setListOpen((v) => !v)}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon
          name={selected?.icon ?? "ListFilter"}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className={cn("min-w-0 flex-1 truncate", selected === undefined && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <Icon
          name="ChevronDown"
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", listOpen && "rotate-180")}
        />
      </button>
      {listOpen && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setListOpen(false)} />
          <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-md">
            {options.length > 4 && (
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={filterPlaceholder ?? "Filter…"}
                aria-label="Filter options"
                autoFocus
                className="h-8 rounded-none border-0 border-b border-border focus-visible:ring-0"
              />
            )}
            <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
              {filtered.map((o) => (
                <li key={o.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.key === value}
                    onClick={() => {
                      onSelect(o.key);
                      setListOpen(false);
                      setFilter("");
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted/60",
                      o.key === value && "bg-muted/40",
                    )}
                  >
                    {o.icon !== undefined && (
                      <Icon name={o.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.sub !== undefined && (
                        <span className="block truncate text-xs text-muted-foreground">{o.sub}</span>
                      )}
                    </span>
                    {o.key === value && <Icon name="Check" className="size-3.5 shrink-0 text-primary" />}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-2.5 py-2 text-xs text-muted-foreground">Nothing matches.</li>
              )}
            </ul>
            {footer}
          </div>
        </>
      )}
    </div>
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

type ItemState = "ready" | "running" | "blocked" | "done";

const STATE_DOT: Record<ItemState, string> = {
  ready: "bg-emerald-500",
  running: "bg-amber-500",
  blocked: "bg-red-500",
  done: "bg-muted-foreground/40",
};

function ticketState(ticket: ScratchTicket): ItemState {
  if (ticket.status === "closed") return "done";
  if (ticket.blocked) return "blocked";
  if (ticket.claimed !== null) return "running";
  return "ready";
}

function CompactRow({
  state,
  refLabel,
  title,
  children,
}: {
  state: ItemState;
  refLabel: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 py-1",
        state === "done" && "opacity-50",
        state === "blocked" && "opacity-70",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[state])} aria-hidden />
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{refLabel}</span>
      <span className="min-w-0 flex-1 truncate text-xs" title={title}>
        {title}
      </span>
      {children}
    </li>
  );
}

function CompactTicketGroup({
  effort,
  disabled,
  onRun,
  onOpen,
}: {
  effort: { slug: string; tickets: ScratchTicket[] };
  disabled: boolean;
  onRun: (ticket: ScratchTicket) => void;
  onOpen: (threadId: string) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const live = effort.tickets.filter((t) => t.status !== "closed");
  const done = effort.tickets.filter((t) => t.status === "closed");
  return (
    <section>
      <SectionTitle>{effort.slug}</SectionTitle>
      <ul>
        {live.map((ticket) => {
          const state = ticketState(ticket);
          return (
            <CompactRow key={ticket.slug} state={state} refLabel={ticket.number} title={ticket.title}>
              {state === "ready" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-xs text-emerald-600 hover:text-emerald-600 dark:text-emerald-400"
                  disabled={disabled}
                  onClick={() => onRun(ticket)}
                >
                  <Icon name="Play" className="size-3" />
                  Run
                </Button>
              )}
              {state === "running" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-xs text-amber-600 hover:text-amber-600 dark:text-amber-400"
                  disabled={disabled || ticket.thread == null}
                  onClick={() => {
                    if (ticket.thread != null) onOpen(ticket.thread.id);
                  }}
                >
                  <Icon name="ArrowUpRight" className="size-3" />
                  Open
                </Button>
              )}
              {state === "blocked" && (
                <span className="shrink-0 text-[11px] text-muted-foreground">blocked</span>
              )}
            </CompactRow>
          );
        })}
      </ul>
      {done.length > 0 && (
        <>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? "Hide" : "Show"} {done.length} done
          </button>
          {showDone && (
            <ul>
              {done.map((ticket) => (
                <CompactRow key={ticket.slug} state="done" refLabel={ticket.number} title={ticket.title} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function CompactIssueGroup({
  feature,
  issues,
  disabled,
  onRun,
}: {
  feature: { slug: string };
  issues: ScratchIssue[];
  disabled: boolean;
  onRun: (issue: ScratchIssue) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const live = issues.filter((i) => i.status !== "done");
  const done = issues.filter((i) => i.status === "done");
  return (
    <section>
      <SectionTitle>{feature.slug} issues</SectionTitle>
      <ul>
        {live.map((issue) => (
          <CompactRow key={issue.slug} state="ready" refLabel={issue.number} title={issue.title}>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-xs text-emerald-600 hover:text-emerald-600 dark:text-emerald-400"
              disabled={disabled}
              onClick={() => onRun(issue)}
            >
              <Icon name="Play" className="size-3" />
              Run
            </Button>
          </CompactRow>
        ))}
      </ul>
      {done.length > 0 && (
        <>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? "Hide" : "Show"} {done.length} done
          </button>
          {showDone && (
            <ul>
              {done.map((issue) => (
                <CompactRow key={issue.slug} state="done" refLabel={issue.number} title={issue.title} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function WorkflowPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
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
  const { section } = result;
  const target = targetOf(section.worktree);
  const runWith = (input: SpawnInput) => spawn({ ...input, open: false });
  return (
    <div className="flex flex-col gap-3 p-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon
            name={section.worktree.isPrimary ? "Home" : "GitBranch"}
            className="size-3 shrink-0 text-muted-foreground"
          />
          <span className="truncate text-xs font-medium">
            {section.worktree.isPrimary
              ? "Primary checkout"
              : (section.worktree.branch ?? "worktree")}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={spawning}
          onClick={refresh}
          aria-label="Rescan"
        >
          <Icon name="RefreshCw" className="size-3" />
        </Button>
      </div>
      {section.index === null ? (
        <div className="px-1 text-xs text-muted-foreground">
          No <code>.scratch/</code> in this checkout yet.
          <div className="mt-2">
            <ChartForm
              disabled={spawning}
              placeholder="Chart a new map here…"
              onChart={(idea) =>
                runWith({ kind: "chart", projectId: result.projectId, idea, target })
              }
            />
          </div>
        </div>
      ) : (
        <>
          {section.index.efforts.map((effort) => (
            <CompactTicketGroup
              key={effort.slug}
              effort={effort}
              disabled={spawning}
              onRun={(ticket) =>
                runWith({
                  kind: "ref",
                  projectId: result.projectId,
                  ref: `${effort.slug}/tickets/${ticket.number}`,
                  target,
                })
              }
              onOpen={(id) => navigate.toThread(id)}
            />
          ))}
          {section.index.features.map((feature) => (
            <CompactIssueGroup
              key={feature.slug}
              feature={{ slug: feature.slug }}
              issues={feature.issues}
              disabled={spawning}
              onRun={(issue) =>
                runWith({
                  kind: "ref",
                  projectId: result.projectId,
                  ref: `${feature.slug}/issues/${issue.number}`,
                  target,
                })
              }
            />
          ))}
          <ChartForm
            disabled={spawning}
            placeholder="Chart a new map here…"
            onChart={(idea) =>
              runWith({ kind: "chart", projectId: result.projectId, idea, target })
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

  const options: PickOption[] = (worktrees ?? [])
    .filter(
      (w) =>
        target.kind !== "existing-host" || w.hostId === undefined || w.hostId === target.hostId,
    )
    .map((w) => ({
      key: w.path,
      label: w.isPrimary ? "Primary checkout" : (w.branch ?? w.path.split("/").pop() ?? w.path),
      sub: w.isPrimary ? w.path : shortPath(w.path),
      icon: w.isPrimary ? "Home" : "GitBranch",
    }));

  if (customOpen) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          value={customPath}
          autoFocus
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
          className="h-8 text-sm"
        />
        {options.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => setCustomOpen(false)}
            aria-label="Back to the list"
          >
            <Icon name="List" className="size-4" />
          </Button>
        )}
      </div>
    );
  }

  if (worktrees !== null && options.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No checkouts known for this project.</p>
    );
  }

  return (
    <Picker
      options={options}
      value={options.some((o) => o.key === selectedPath) ? selectedPath : null}
      onSelect={(path) => onChange({ status: "ready", value: { path } })}
      placeholder={worktrees === null ? "Loading checkouts…" : "Pick a checkout…"}
      filterPlaceholder="Filter by branch or path…"
      disabled={worktrees === null}
      footer={
        <button
          type="button"
          className="w-full border-t border-border px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          onClick={() => setCustomOpen(true)}
        >
          Custom path…
        </button>
      }
    />
  );
}

function shortPath(path: string): string {
  const parts = path.split("/").filter((p) => p !== "");
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

const NEW_WORKTREE_KEY = "__new-worktree__";

function WorktreeSpawnPanel({ projectId }: PluginNewThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [sections, setSections] = useState<WorkflowSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [where, setWhere] = useState<string | null>(NEW_WORKTREE_KEY);
  const [busy, setBusy] = useState(false);

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

  if (projectId === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Pick a project first — its checkouts appear here.
      </p>
    );
  }
  if (error !== null) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }

  const worktrees = (sections ?? []).map((s) => s.worktree);
  const options: PickOption[] = [
    {
      key: NEW_WORKTREE_KEY,
      label: "New worktree",
      sub: "BB creates a fresh worktree + branch for this thread",
      icon: "GitBranchPlus",
    },
    ...worktrees.map((w) => ({
      key: w.path,
      label: w.isPrimary ? "Primary checkout" : (w.branch ?? w.path.split("/").pop() ?? w.path),
      sub: w.isPrimary ? w.path : shortPath(w.path),
      icon: w.isPrimary ? "Home" : "GitBranch",
    })),
  ];

  const start = async () => {
    const text = prompt.trim();
    if (text === "" || where === null) return;
    setBusy(true);
    try {
      const chosen = worktrees.find((w) => w.path === where);
      const spawned = await rpc.call("spawn", {
        kind: "manual",
        projectId,
        prompt: text,
        ...(where === NEW_WORKTREE_KEY
          ? { newWorktree: true }
          : { target: chosen !== undefined ? targetOf(chosen) : { path: where } }),
      } as never);
      toast.success(`Started “${spawned.title}”`);
      setPrompt("");
      navigate.toThread(spawned.threadId);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={prompt}
        autoFocus
        disabled={busy}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && prompt.trim() !== "" && where !== null) {
            void start();
          }
        }}
        placeholder="Describe the problem to work on…"
        aria-label="Problem description"
        className="h-8 text-sm"
      />
      <Picker
        options={options}
        value={where}
        onSelect={setWhere}
        placeholder={sections === null ? "Loading checkouts…" : "Where should it work?"}
        filterPlaceholder="Filter by branch or path…"
        disabled={sections === null || busy}
      />
      <Button
        className="h-8 gap-1.5"
        disabled={busy || prompt.trim() === "" || where === null}
        onClick={() => void start()}
      >
        <Icon name="Play" className="size-3.5" />
        {busy ? "Starting…" : "Start"}
      </Button>
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
