import type { KeyboardEvent, Ref } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { TreeNode } from "../tree";
import { ChangeKindLetter, Stats, type StatsWidths } from "./Stats";

const INDENT_PX = 12;

export interface TreeRowProps {
  node: TreeNode;
  depth: number;
  /** Folder: its children are shown. File: its patch is shown. */
  open: boolean;
  focusable: boolean;
  widths: StatsWidths;
  rowRef: Ref<HTMLDivElement>;
  onToggle(): void;
  onFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  /** Null when the file cannot be opened (deleted, or a folder). */
  onOpenFile: (() => void) | null;
}

export function TreeRow({ node, depth, open, focusable, widths, rowRef, onToggle, onFocus, onKeyDown, onOpenFile }: TreeRowProps) {
  const isDir = node.kind === "dir";
  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isDir ? open : undefined}
      aria-selected={isDir ? undefined : open}
      tabIndex={focusable ? 0 : -1}
      data-path={node.path}
      title={isDir ? `${node.path}/ · ${node.fileCount} ${node.fileCount === 1 ? "file" : "files"}` : node.path}
      onClick={onToggle}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={cn(
        "group flex h-7 min-w-0 cursor-pointer select-none items-center gap-1 pr-2 text-[13px] outline-none",
        "hover:bg-state-hover focus-visible:bg-state-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        !isDir && open && "bg-state-active",
      )}
      style={{ paddingLeft: 8 + depth * INDENT_PX }}
    >
      {isDir ? (
        <Icon name={open ? "ChevronDown" : "ChevronRight"} aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <ChangeKindLetter file={node.file} />
      )}
      <span className={cn("min-w-0 shrink truncate", isDir ? "text-foreground" : "text-foreground/90")}>
        {node.name}
        {isDir ? <span className="text-muted-foreground">/</span> : null}
      </span>
      {node.kind === "file" && node.file.previousPath !== null ? (
        <span className="min-w-0 shrink-[2] truncate text-xs text-muted-foreground" title={`Renamed from ${node.file.previousPath}`}>
          ← {node.file.previousPath}
        </span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-1 pl-1">
        {onOpenFile === null ? (
          <span aria-hidden className="size-5" />
        ) : (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Open ${node.path}`}
            title="Open file"
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile();
            }}
            className="invisible flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground group-hover:visible group-focus-visible:visible"
          >
            <Icon name="ExternalLink" aria-hidden className="size-3.5" />
          </button>
        )}
        <Stats
          additions={node.additions}
          deletions={node.deletions}
          binary={node.kind === "file" && node.file.binary}
          widths={widths}
          className="text-xs"
        />
      </span>
    </div>
  );
}
