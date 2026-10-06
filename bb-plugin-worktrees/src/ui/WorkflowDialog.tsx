import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  useBbNavigate,
  type ExperimentalProviderModelPickerValue,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn, formatHomePathForDisplay } from "@/lib/utils";
import type { ScratchEffort, ScratchIndex, ScratchTicket } from "../contract";
import { errorMessage, useWorktreesRpc } from "./data";

type AgentRequest = { request?: Record<string, unknown> };
type Modifiers = { metaKey: boolean; ctrlKey: boolean };
type Launch = (key: string, label: string, event: Modifiers, start: (agentRequest: AgentRequest) => Promise<{ threadId: string }>) => void;

export function WorkflowDialog(props: {
  projectId: string;
  worktreePath: string;
  worktreeLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { projectId, worktreePath: path, worktreeLabel, open, onOpenChange } = props;
  const rpc = useWorktreesRpc();
  const navigate = useBbNavigate();
  const [index, setIndex] = useState<ScratchIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agent, setAgent] = useState<ExperimentalProviderModelPickerValue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [idea, setIdea] = useState("");

  const reload = useCallback(() => {
    rpc.call("scratch", { projectId, path }).then(
      (result) => {
        setIndex(result);
        setLoadError(null);
      },
      (cause: unknown) => setLoadError(errorMessage(cause)),
    );
  }, [rpc, projectId, path]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open || agent !== null) return;
    let cancelled = false;
    rpc.call("agentDefaults", { projectId }).then(
      (defaults) => !cancelled && defaults !== null && setAgent(defaults as ExperimentalProviderModelPickerValue),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, open, projectId, agent]);

  const launch: Launch = (key, label, event, start) => {
    const stay = event.metaKey || event.ctrlKey;
    setBusy(key);
    const request = agent === null ? null : Object.fromEntries(Object.entries(agent).filter(([, value]) => value !== undefined));
    start(request === null ? {} : { request }).then(
      ({ threadId }) => {
        setBusy(null);
        if (stay) {
          toast.success(`Started ${label}`, { action: { label: "Open", onClick: () => navigate.toThread(threadId) } });
          reload();
        } else {
          toast.success(`Started ${label}`);
          onOpenChange(false);
          navigate.toThread(threadId);
        }
      },
      (cause: unknown) => {
        setBusy(null);
        toast.error(errorMessage(cause));
      },
    );
  };

  const target = { projectId, path };
  const chart = (event: Modifiers) => {
    const trimmed = idea.trim();
    if (trimmed === "") return;
    launch("chart", "charting", event, (agentRequest) => rpc.call("chart", { ...target, idea: trimmed, ...agentRequest }));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => busy === null && onOpenChange(next)}>
      <DialogContent className="w-[min(40rem,calc(100vw-2rem))] max-w-none gap-4">
        <DialogHeader>
          <DialogTitle>Workflow — {worktreeLabel}</DialogTitle>
          <DialogDescription className="truncate" title={path}>
            {formatHomePathForDisplay(path)}/.scratch
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 grid max-h-[60vh] gap-4 overflow-y-auto px-1 text-sm">
          {loadError !== null ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
              {loadError}
            </p>
          ) : index === null ? (
            <p className="text-xs text-muted-foreground">Reading .scratch…</p>
          ) : index.efforts.length === 0 ? (
            <p className="text-muted-foreground">No maps or issues in this worktree's .scratch yet.</p>
          ) : (
            index.efforts.map((effort) => (
              <EffortSection
                key={effort.slug}
                effort={effort}
                busy={busy}
                onRunTicket={(ticket, event) =>
                  launch(ticket.ref, ticket.ref, event, (agentRequest) => rpc.call("runTicket", { ...target, ref: ticket.ref, ...agentRequest }))
                }
                onHandoff={(event) =>
                  launch(`${effort.slug}/handoff`, `${effort.slug} handoff`, event, (agentRequest) =>
                    rpc.call("handoff", { ...target, effort: effort.slug, ...agentRequest }),
                  )
                }
                onOrchestrate={(numbers, event) =>
                  launch(`${effort.slug}/orchestrate`, `${effort.slug}/${numbers.join(", ")}`, event, (agentRequest) =>
                    rpc.call("orchestrate", { ...target, effort: effort.slug, issues: numbers, ...agentRequest }),
                  )
                }
              />
            ))
          )}

          <section className="grid gap-1.5 border-t border-border pt-3">
            <h3 className="text-xs font-medium text-muted-foreground">Chart a new map</h3>
            <div className="flex items-center gap-2">
              <Input
                value={idea}
                onChange={(event) => setIdea(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") chart(event);
                }}
                placeholder="The idea, in a line or two"
                className="h-8"
                aria-label="Idea for a new map"
              />
              <Button size="sm" variant="outline" disabled={busy !== null || idea.trim() === ""} onClick={chart}>
                {busy === "chart" ? "Starting…" : "Chart"}
              </Button>
            </div>
          </section>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          {agent !== null ? (
            <ProviderModelPicker value={agent} onChange={setAgent} disabled={busy !== null} />
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">⌘-click to start without leaving</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EffortSection({
  effort,
  busy,
  onRunTicket,
  onHandoff,
  onOrchestrate,
}: {
  effort: ScratchEffort;
  busy: string | null;
  onRunTicket: (ticket: ScratchTicket, event: Modifiers) => void;
  onHandoff: (event: Modifiers) => void;
  onOrchestrate: (numbers: string[], event: Modifiers) => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const frontier = effort.tickets.filter((ticket) => ticket.state === "frontier");
  const blocked = effort.tickets.filter((ticket) => ticket.state === "blocked");
  const closed = effort.tickets.length - frontier.length - blocked.length;
  const openIssues = effort.issues.filter((issue) => issue.status !== "done");
  const doneIssues = effort.issues.length - openIssues.length;
  const titleOf = (number: string) => effort.tickets.find((ticket) => ticket.number === number)?.title ?? "missing ticket";
  const batch = openIssues.map((issue) => issue.number).filter((number) => selected.has(number));

  const toggle = (number: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(number);
      else next.delete(number);
      return next;
    });

  const summary = [
    effort.mapPath !== null ? `${closed}/${effort.tickets.length} tickets closed` : null,
    effort.issues.length > 0 ? `${doneIssues}/${effort.issues.length} issues done` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate font-medium">{effort.slug}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">{summary}</span>
      </div>

      {effort.mapPath !== null ? (
        <ul className="grid">
          {frontier.map((ticket) => (
            <Row
              key={ticket.ref}
              number={ticket.number}
              title={ticket.title}
              meta={ticket.claimed ? `${ticket.type} · claimed` : ticket.type}
              hint={ticket.claimed ? `Claimed ${ticket.claimed}; running it takes the claim over` : undefined}
            >
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={busy !== null}
                onClick={(event) => onRunTicket(ticket, event)}
              >
                {busy === ticket.ref ? "Starting…" : "Run"}
              </Button>
            </Row>
          ))}
          {blocked.map((ticket) => (
            <Row
              key={ticket.ref}
              number={ticket.number}
              title={ticket.title}
              meta={`blocked by ${ticket.blockers.join(", ")}`}
              hint={ticket.blockers.map((number) => `${number} ${titleOf(number)}`).join("\n")}
              dim
            />
          ))}
          {effort.handoffReady ? (
            <Row title="Every ticket is closed — hand the map off to a PRD and issues">
              <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={onHandoff}>
                {busy === `${effort.slug}/handoff` ? "Starting…" : "Hand off"}
              </Button>
            </Row>
          ) : null}
        </ul>
      ) : null}

      {openIssues.length > 0 ? (
        <div className="grid gap-1">
          <ul className="grid">
            {openIssues.map((issue) => (
              <li key={issue.ref}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-state-hover">
                  <Checkbox checked={selected.has(issue.number)} onCheckedChange={(value) => toggle(issue.number, value === true)} />
                  <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{issue.number}</span>
                  <span className="min-w-0 flex-1 truncate" title={issue.title}>
                    {issue.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{issue.status}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex justify-end px-2">
            <Button size="sm" variant="outline" className="h-7" disabled={busy !== null || batch.length === 0} onClick={(event) => onOrchestrate(batch, event)}>
              {busy === `${effort.slug}/orchestrate` ? "Starting…" : batch.length > 0 ? `Orchestrate ${batch.length} selected` : "Orchestrate selected"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Row({
  number,
  title,
  meta,
  hint,
  dim = false,
  children,
}: {
  number?: string;
  title: string;
  meta?: string;
  hint?: string;
  dim?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={cn("flex min-h-8 items-center gap-2 rounded-md px-2 py-0.5 hover:bg-state-hover", dim && "opacity-55")} title={hint}>
      <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{number}</span>
      <span className="min-w-0 flex-1 truncate" title={hint === undefined ? title : undefined}>
        {title}
      </span>
      {meta !== undefined ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
      {children}
    </li>
  );
}
