import { useEffect, useId, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectConfig, ResolvedConfig } from "../contract";
import { errorMessage, useWorktreesRpc } from "./data";
import { useProjectConfig } from "./fields";

type Draft = { baseRef: string; overlayDir: string; setupCommand: string; teardownCommand: string; tool: ProjectConfig["tool"] };

function toDraft(config: ResolvedConfig): Draft {
  return {
    baseRef: config.baseRef ?? "",
    overlayDir: config.overlayDir ?? "",
    setupCommand: config.setupCommand ?? "",
    teardownCommand: config.teardownCommand ?? "",
    tool: config.tool,
  };
}

const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

function fromDraft(draft: Draft): ProjectConfig {
  return {
    baseRef: orNull(draft.baseRef),
    overlayDir: orNull(draft.overlayDir),
    setupCommand: orNull(draft.setupCommand),
    teardownCommand: orNull(draft.teardownCommand),
    tool: draft.tool,
  };
}

function Field({
  label,
  hint,
  value,
  placeholder,
  onChange,
  mono = true,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  mono?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={mono ? "h-8 font-mono text-sm" : "h-8 text-sm"}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ProjectSettingsForm({ projectId, onSaved }: { projectId: string; onSaved?: () => void }) {
  const rpc = useWorktreesRpc();
  const { config, error, setConfig } = useProjectConfig(projectId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const toolId = useId();

  useEffect(() => {
    if (config !== null) setDraft(toDraft(config));
  }, [config]);

  if (error !== null) return <p className="text-sm text-destructive">{error}</p>;
  if (config === null || draft === null) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(fromDraft(draft)) !== JSON.stringify(fromDraft(toDraft(config)));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await rpc.call("setConfig", { projectId, config: fromDraft(draft) });
      setConfig(saved);
      toast.success("Saved worktree settings");
      onSaved?.();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Base ref"
          hint="New tasks branch from here."
          value={draft.baseRef}
          placeholder={config.effectiveBaseRef}
          onChange={(baseRef) => update({ baseRef })}
        />
        <Field
          label="Overlay directory"
          hint="AGENTS.md files and top-level files linked into each new worktree."
          value={draft.overlayDir}
          placeholder={config.effectiveOverlayDir ?? "none"}
          onChange={(overlayDir) => update({ overlayDir })}
        />
        <Field
          label="Setup command"
          hint="Runs in the new worktree."
          value={draft.setupCommand}
          placeholder="none"
          onChange={(setupCommand) => update({ setupCommand })}
        />
        <Field
          label="Teardown command"
          hint="Runs in the source checkout before removal."
          value={draft.teardownCommand}
          placeholder="none"
          onChange={(teardownCommand) => update({ teardownCommand })}
        />
      </div>
      <div className="grid gap-1.5 sm:max-w-[50%]">
        <Label htmlFor={toolId}>Worktree tool</Label>
        <select
          id={toolId}
          value={draft.tool}
          onChange={(event) => update({ tool: event.target.value as ProjectConfig["tool"] })}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="auto">Automatic (uses {config.effectiveTool === "gtr" ? "git gtr" : "git worktree"})</option>
          <option value="gtr">git gtr</option>
          <option value="git">git worktree</option>
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={!dirty || saving} onClick={() => setDraft(toDraft(config))}>
          Reset
        </Button>
        <Button type="submit" size="sm" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

export function ProjectSettingsDialog({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(40rem,calc(100vw-2rem))] max-w-none">
        <DialogHeader>
          <DialogTitle>Worktree settings — {projectName}</DialogTitle>
          <DialogDescription>Used by New task, Remove worktree, and `bb task`.</DialogDescription>
        </DialogHeader>
        <ProjectSettingsForm projectId={projectId} onSaved={onClose} />
      </DialogContent>
    </Dialog>
  );
}

export function SettingsSection() {
  const sdk = useSdk();
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    sdk.projects.list().then(
      (result) => !cancelled && setProjects(result.map((project) => ({ id: project.id, name: project.name }))),
      (cause: unknown) => !cancelled && setError(errorMessage(cause)),
    );
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  if (error !== null) return <p className="text-sm text-destructive">{error}</p>;
  if (projects === null) return <p className="text-sm text-muted-foreground">Loading projects…</p>;
  if (projects.length === 0) return <p className="text-sm text-muted-foreground">No projects yet.</p>;

  return (
    <div className="grid gap-3">
      {projects.map((project) => (
        <details key={project.id} className="group rounded-lg border border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
            {project.name}
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">Edit</span>
          </summary>
          <div className="border-t border-border px-4 py-4">
            <ProjectSettingsForm projectId={project.id} />
          </div>
        </details>
      ))}
    </div>
  );
}
