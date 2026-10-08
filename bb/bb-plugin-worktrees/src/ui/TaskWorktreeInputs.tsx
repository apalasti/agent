import { forwardRef, useEffect, useState, type ComponentPropsWithoutRef } from "react";
import type { PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { taskWorktreeInputsSchema } from "../contract";
import { TaskFields, useBranchCheck, useProjectConfig } from "./fields";
import { cleanInputs, useDialogTaskInputs } from "./taskDraft";

function parseInputs(value: unknown) {
  const parsed = taskWorktreeInputsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

type ChipProps = ComponentPropsWithoutRef<typeof Button> & { branch: string | undefined; base: string | null };

const Chip = forwardRef<HTMLButtonElement, ChipProps>(({ branch, base, ...props }, ref) => (
  <Button
    ref={ref}
    type="button"
    variant="ghost"
    size="sm"
    aria-label={`Task worktree branch: ${branch ?? "named from the prompt"}${base ? `, from ${base}` : ""}`}
    className="h-7 max-w-64 gap-1.5 px-2 text-xs font-normal text-muted-foreground disabled:opacity-100"
    {...props}
  >
    <Icon name="GitBranch" className="size-3.5 shrink-0" />
    <span className="truncate font-mono">{branch ?? "auto branch"}</span>
    {base ? <span className="shrink-0 truncate text-subtle-foreground">from {base}</span> : null}
  </Button>
));
Chip.displayName = "TaskWorktreeChip";

export function TaskWorktreeInputs({ projectId, value, onChange }: PluginEnvironmentProviderInputsProps) {
  const dialogInputs = useDialogTaskInputs();
  const { config } = useProjectConfig(projectId);
  const initial = parseInputs(value);
  const [branch, setBranch] = useState(initial.branch ?? "");
  const [from, setFrom] = useState(initial.from ?? "");
  const [open, setOpen] = useState(false);
  const check = useBranchCheck(projectId, branch);
  const defaultBase = config?.effectiveBaseRef ?? null;

  useEffect(() => {
    if (dialogInputs !== null) {
      onChange({ status: "ready", value: { ...dialogInputs } });
    } else if (check.state === "invalid") {
      onChange({ status: "blocked", reason: check.message });
    } else {
      onChange({ status: "ready", value: { ...cleanInputs(branch, from) } });
    }
    // onChange is not a dependency: the SDK does not promise it is stable, and reporting on each new identity could loop.
  }, [dialogInputs, branch, from, check.state === "invalid" ? check.message : check.state]);

  if (dialogInputs !== null) {
    return <Chip branch={dialogInputs.branch} base={dialogInputs.from ?? defaultBase} disabled />;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip branch={branch.trim() || undefined} base={from.trim() || defaultBase} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <TaskFields
          projectId={projectId}
          branch={branch}
          onBranchChange={setBranch}
          from={from}
          onFromChange={setFrom}
          defaultBase={defaultBase}
          check={check}
          autoFocus
          compact
        />
        <p className="mt-2 text-xs text-muted-foreground">Leave the branch empty to name it from the prompt.</p>
      </PopoverContent>
    </Popover>
  );
}
