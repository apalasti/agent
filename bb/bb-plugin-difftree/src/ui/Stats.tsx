import { cn } from "@/lib/utils";
import type { ChangeKind, ChangedFile } from "../contract";

export interface StatsWidths {
  additions: number;
  deletions: number;
}

/** Character widths that fit the largest `+a` and `−r` in the tree, so every row's numbers line up. */
export function statsWidths(additions: number, deletions: number): StatsWidths {
  return { additions: String(additions).length + 1, deletions: String(deletions).length + 1 };
}

export function Stats({
  additions,
  deletions,
  binary = false,
  widths,
  className,
}: {
  additions: number;
  deletions: number;
  binary?: boolean;
  widths?: StatsWidths;
  className?: string;
}) {
  if (binary) {
    return <span className={cn("shrink-0 whitespace-nowrap text-muted-foreground", className)}>binary</span>;
  }
  return (
    <span className={cn("inline-flex shrink-0 gap-1.5 whitespace-nowrap tabular-nums", className)}>
      <span
        className={cn("text-right", additions === 0 ? "text-muted-foreground" : "text-diff-added")}
        style={widths && { minWidth: `${widths.additions}ch` }}
      >
        +{additions}
      </span>
      <span
        className={cn("text-right", deletions === 0 ? "text-muted-foreground" : "text-diff-removed")}
        style={widths && { minWidth: `${widths.deletions}ch` }}
      >
        −{deletions}
      </span>
    </span>
  );
}

const KIND: Record<ChangeKind, { letter: string; label: string; className: string }> = {
  added: { letter: "A", label: "Added", className: "text-diff-added" },
  deleted: { letter: "D", label: "Deleted", className: "text-diff-removed" },
  modified: { letter: "M", label: "Modified", className: "text-warning-text" },
  renamed: { letter: "R", label: "Renamed", className: "text-file-accent" },
  copied: { letter: "C", label: "Copied", className: "text-file-accent" },
  type_changed: { letter: "T", label: "Type changed", className: "text-muted-foreground" },
};

export function changeKindTitle(file: ChangedFile): string {
  if (file.untracked) return "Untracked: a new file git does not track yet";
  const { label } = KIND[file.changeKind];
  return file.previousPath === null ? label : `${label} from ${file.previousPath}`;
}

export function ChangeKindLetter({ file }: { file: ChangedFile }) {
  const kind = KIND[file.changeKind];
  return (
    <span
      className={cn("w-4 shrink-0 text-center text-xs font-semibold", kind.className)}
      title={changeKindTitle(file)}
      data-change-kind={file.untracked ? "untracked" : file.changeKind}
    >
      {kind.letter}
    </span>
  );
}
