import { createContext, useContext, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadSplit,
  ThreadTitle,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
  useSidebarThreadShortcut,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { WorktreeStatus } from "../contract";
import { rollupIndicator, type ProjectNode, type ThreadNode, type WorktreeNode } from "../group";
import { collapseKey, useIsOnScreen, useWorktreeStatus } from "./data";
import { IndicatorGlyph, RollupGlyph, RowStatusGlyph, rowStatusWins, withDraft } from "./glyphs";

export type ListContextValue = {
  activeThreadId: string | null;
  onNavigate: () => void;
  isCollapsed: (key: string) => boolean;
  toggle: (key: string) => void;
  openNewTask: (projectId: string) => void;
  openNewThreadIn: (projectId: string, group: WorktreeNode) => void;
  openRemove: (projectId: string, group: WorktreeNode) => void;
  openWorkflow: (projectId: string, group: WorktreeNode) => void;
  openSettings: (projectId: string) => void;
  refresh: () => void;
};

export const ListContext = createContext<ListContextValue | null>(null);

function useList(): ListContextValue {
  const value = useContext(ListContext);
  if (value === null) throw new Error("Worktree rows must render inside ListContext");
  return value;
}

const ROW = "relative flex w-full items-center gap-2 rounded-md pr-0 text-sm";
const GROUP_ROW = cn(ROW, "group/row h-7 text-muted-foreground");
const ICON_BUTTON =
  "relative z-10 size-7 shrink-0 rounded-md p-0 text-subtle-foreground hover:bg-state-hover hover:text-muted-foreground data-[state=open]:bg-state-active data-[state=open]:text-muted-foreground [&_[data-icon-root]]:size-4";
const REVEAL_ON_HOVER =
  "pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 group-has-[[data-state=open]]/row:pointer-events-auto group-has-[[data-state=open]]/row:opacity-100";
const HIDE_ON_HOVER =
  "group-hover/row:opacity-0 group-focus-within/row:opacity-0 group-has-[[data-state=open]]/row:opacity-0";

const indent = (depth: number): CSSProperties => ({ paddingLeft: 8 + depth * 24 });

function stop(event: MouseEvent) {
  event.stopPropagation();
}

function HoverButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <Tooltip delayDuration={350} disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          className={ICON_BUTTON}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
        >
          <Icon name={icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

type MenuEntry =
  | { kind: "item"; label: string; icon: string; onSelect: () => void; destructive?: boolean }
  | { kind: "separator" };

function MoreMenu({ label, entries }: { label: string; entries: MenuEntry[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} className={ICON_BUTTON} onClick={stop}>
          <Icon name="MoreHorizontal" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" mobileTitle={label}>
        {entries.map((entry, index) =>
          entry.kind === "separator" ? (
            <DropdownMenuSeparator key={index} />
          ) : (
            <DropdownMenuItem
              key={entry.label}
              variant={entry.destructive ? "destructive" : "default"}
              onSelect={entry.onSelect}
            >
              <Icon name={entry.icon} aria-hidden="true" />
              {entry.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ContextEntries({ entries }: { entries: MenuEntry[] }) {
  return (
    <ContextMenuContent>
      {entries.map((entry, index) =>
        entry.kind === "separator" ? (
          <ContextMenuSeparator key={index} />
        ) : (
          <ContextMenuItem
            key={entry.label}
            className={entry.destructive ? "text-destructive focus:text-destructive" : undefined}
            onSelect={entry.onSelect}
          >
            <Icon name={entry.icon} aria-hidden="true" />
            {entry.label}
          </ContextMenuItem>
        ),
      )}
    </ContextMenuContent>
  );
}

function Chevron({
  collapsed,
  onToggle,
  label,
  revealOnHover = false,
}: {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  revealOnHover?: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "relative z-10 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2",
        revealOnHover ? REVEAL_ON_HOVER : "pointer-events-auto",
      )}
    >
      <Icon name="ChevronRight" className={cn("size-3 transition-transform duration-150", !collapsed && "rotate-90")} />
    </button>
  );
}

function Trailing({ passive, actions }: { passive: ReactNode; actions: ReactNode }) {
  return (
    <span className={cn("relative z-10 flex h-7 shrink-0 items-center justify-end", actions && "group-hover/row:min-w-[3.625rem]")}>
      {passive ? (
        <span className={cn("pointer-events-none flex items-center gap-1.5 pr-1.5 transition-opacity", actions && HIDE_ON_HOVER)}>
          {passive}
        </span>
      ) : null}
      {actions ? (
        <span className={cn("absolute inset-y-0 right-0 flex items-center gap-0.5", REVEAL_ON_HOVER)}>{actions}</span>
      ) : null}
    </span>
  );
}

export function GroupHeader({
  label,
  collapsed,
  onToggle,
  passive,
  actions,
  className,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  passive?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(GROUP_ROW, "pl-2 text-xs font-medium text-sidebar-foreground/75", className)}>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onToggle}
        className="absolute inset-0 rounded-md outline-none"
      />
      <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1">
        <span className="min-w-0 truncate">{label}</span>
        <span className="pointer-events-auto">
          <Chevron collapsed={collapsed} onToggle={onToggle} label={label} revealOnHover={!collapsed} />
        </span>
      </span>
      <Trailing passive={passive} actions={actions} />
    </div>
  );
}

export function ProjectRow({ node }: { node: ProjectNode }) {
  const list = useList();
  const actions = experimental_useSidebarThreadActions();
  const { project } = node;
  const key = collapseKey.project(project.id);
  const collapsed = list.isCollapsed(key);
  const allThreads = node.worktrees.flatMap((group) => group.threads);
  return (
    <GroupHeader
      label={project.name}
      collapsed={collapsed}
      onToggle={() => list.toggle(key)}
      passive={collapsed ? <RollupGlyph rollup={rollupIndicator(allThreads)} /> : null}
      actions={
        <>
          <HoverButton label={`New task in ${project.name}`} icon="Plus" onClick={() => list.openNewTask(project.id)} />
          <MoreMenu
            label={`${project.name} actions`}
            entries={[
              { kind: "item", label: "New task…", icon: "Plus", onSelect: () => list.openNewTask(project.id) },
              {
                kind: "item",
                label: "New thread",
                icon: "MessageSquarePlus",
                onSelect: () => {
                  actions.openNewThread({ projectId: project.id, focusPrompt: true });
                  list.onNavigate();
                },
              },
              { kind: "separator" },
              { kind: "item", label: "Refresh worktrees", icon: "RotateCcw", onSelect: list.refresh },
              { kind: "item", label: "Worktree settings…", icon: "Settings", onSelect: () => list.openSettings(project.id) },
            ]}
          />
        </>
      }
    />
  );
}

function worktreeIcon(group: WorktreeNode): string {
  if (group.kind === "other") return "MessageSquare";
  if (group.kind === "unmatched") return "Folder";
  return group.worktree?.isMain ? "FolderGit" : "GitBranch";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function statusSummary({ dirtyFiles, ahead, behind, upstream }: WorktreeStatus): string | null {
  const parts: string[] = [];
  if (dirtyFiles > 0) parts.push(plural(dirtyFiles, "uncommitted file"));
  const target = upstream ?? "upstream";
  if (ahead > 0 && behind > 0) parts.push(`${ahead} ahead, ${behind} behind ${target}`);
  else if (ahead > 0) parts.push(`${ahead} ahead of ${target}`);
  else if (behind > 0) parts.push(`${behind} behind ${target}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function IdleWorktreesRow({ count, collapsed, onToggle }: { count: number; collapsed: boolean; onToggle: () => void }) {
  const label = `${count} idle ${count === 1 ? "worktree" : "worktrees"}`;
  return (
    <div className={cn(GROUP_ROW, "text-xs")} style={indent(0)}>
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onToggle} className="absolute inset-0 rounded-md outline-none" />
      <span className="pointer-events-none relative z-10 inline-flex size-4 shrink-0 items-center justify-center">
        <Icon name="Layers" className="size-4" aria-hidden="true" />
      </span>
      <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1 opacity-75">
        <span className="min-w-0 truncate">{label}</span>
        <span className="pointer-events-auto">
          <Chevron collapsed={collapsed} onToggle={onToggle} label={label} />
        </span>
      </span>
    </div>
  );
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${what}`);
  } catch {
    toast.error(`Couldn't copy ${what}`);
  }
}

export function WorktreeRow({ projectId, group, depth = 0 }: { projectId: string; group: WorktreeNode; depth?: number }) {
  const list = useList();
  const [ref, isOnScreen] = useIsOnScreen<HTMLDivElement>();
  const status = useWorktreeStatus(projectId, group.kind === "worktree" ? group.path : null, isOnScreen);
  const key = collapseKey.worktree(projectId, group.key);
  const collapsed = list.isCollapsed(key);
  const isEmpty = group.threadCount === 0;
  const canCreate = group.path !== null;
  const canRemove = group.kind === "worktree" && group.worktree !== null && !group.worktree.isMain;

  const entries: MenuEntry[] = [];
  if (canCreate) {
    entries.push({ kind: "item", label: "New thread here", icon: "MessageSquarePlus", onSelect: () => list.openNewThreadIn(projectId, group) });
  }
  if (group.kind === "worktree") {
    entries.push({ kind: "item", label: "Workflow…", icon: "Workflow", onSelect: () => list.openWorkflow(projectId, group) });
  }
  if (group.path !== null) {
    const path = group.path;
    entries.push({ kind: "item", label: "Copy path", icon: "Copy", onSelect: () => void copyText(path, "path") });
  }
  if (group.worktree?.branch) {
    const branch = group.worktree.branch;
    entries.push({ kind: "item", label: "Copy branch name", icon: "GitBranch", onSelect: () => void copyText(branch, "branch name") });
  }
  if (canRemove) {
    entries.push({ kind: "separator" });
    entries.push({
      kind: "item",
      label: "Remove worktree…",
      icon: "Trash2",
      destructive: true,
      onSelect: () => list.openRemove(projectId, group),
    });
  }

  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const dirty = status?.dirtyFiles ?? 0;
  const summary = status ? statusSummary(status) : null;

  return (
    <div
      ref={ref}
      className={GROUP_ROW}
      style={indent(depth)}
      title={group.path ?? undefined}
      data-worktree-path={group.path ?? undefined}
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        disabled={isEmpty}
        onClick={() => list.toggle(key)}
        className="absolute inset-0 rounded-md outline-none"
      />
      <span className="pointer-events-none relative z-10 inline-flex size-4 shrink-0 items-center justify-center">
        <Icon name={worktreeIcon(group)} className="size-4" aria-hidden="true" />
      </span>
      <span className={cn("pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1.5", isEmpty && "opacity-60")}>
        <span className={cn("min-w-0 truncate", group.kind === "worktree" && group.worktree?.isMain && "text-sidebar-foreground/90")}>
          {group.label}
        </span>
        {group.worktree?.isDetached ? <span className="shrink-0 text-subtle-foreground">· detached</span> : null}
        {group.worktree?.isLocked ? <Icon name="Lock" className="size-3 shrink-0" aria-label="Locked worktree" /> : null}
        {summary ? (
          <Tooltip delayDuration={350} disableHoverableContent>
            <TooltipTrigger asChild>
              <span role="img" aria-label={summary} title={summary} className="pointer-events-auto flex h-7 shrink-0 items-center gap-1.5 px-0.5">
                {dirty > 0 ? <span className="size-1.5 shrink-0 rounded-full bg-amber-500/80" /> : null}
                {ahead > 0 || behind > 0 ? (
                  <span className="text-[11px] tabular-nums text-subtle-foreground">
                    {ahead > 0 ? `↑${ahead}` : null}
                    {ahead > 0 && behind > 0 ? " " : null}
                    {behind > 0 ? `↓${behind}` : null}
                  </span>
                ) : null}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{summary}</TooltipContent>
          </Tooltip>
        ) : null}
        {isEmpty ? null : (
          <span className="pointer-events-auto">
            <Chevron collapsed={collapsed} onToggle={() => list.toggle(key)} label={`${group.label} threads`} revealOnHover={!collapsed} />
          </span>
        )}
      </span>
      <Trailing
        passive={
          collapsed && !isEmpty ? (
            <>
              <RollupGlyph rollup={rollupIndicator(group.threads)} />
              <span className="text-xs tabular-nums text-subtle-foreground">{group.threadCount}</span>
            </>
          ) : null
        }
        actions={
          entries.length > 0 ? (
            <>
              {canCreate ? (
                <HoverButton label={`New thread in ${group.label}`} icon="MessageSquarePlus" onClick={() => list.openNewThreadIn(projectId, group)} />
              ) : null}
              <MoreMenu label={`${group.label} actions`} entries={entries} />
            </>
          ) : null
        }
      />
    </div>
  );
}

function threadEntries(
  thread: PluginSidebarThread,
  actions: ReturnType<typeof experimental_useSidebarThreadActions>,
  canSplit: boolean,
  startRename: () => void,
  onNavigate: () => void,
): MenuEntry[] {
  const entries: MenuEntry[] = [];
  if (canSplit) {
    entries.push({
      kind: "item",
      label: "Open in split",
      icon: "Columns2",
      onSelect: () => {
        actions.open(thread.id, { split: true });
        onNavigate();
      },
    });
  }
  entries.push(
    {
      kind: "item",
      label: thread.isPinned ? "Unpin" : "Pin",
      icon: thread.isPinned ? "PinOff" : "Pin",
      onSelect: () => void actions.setPinned(thread.id, !thread.isPinned),
    },
    {
      kind: "item",
      label: thread.isUnread ? "Mark as read" : "Mark as unread",
      icon: thread.isUnread ? "MailOpen" : "Mail",
      onSelect: () => void actions.setRead(thread.id, thread.isUnread),
    },
    { kind: "item", label: "Rename", icon: "Edit", onSelect: startRename },
    {
      kind: "item",
      label: "Copy link",
      icon: "Copy",
      onSelect: () => void copyText(new URL(thread.href, window.location.origin).toString(), "link"),
    },
    { kind: "separator" },
    { kind: "item", label: "Archive", icon: "Archive", onSelect: () => actions.archive(thread.id) },
    { kind: "item", label: "Delete…", icon: "Trash2", destructive: true, onSelect: () => actions.requestDelete(thread.id) },
  );
  return entries;
}

function RenameField({ thread, onDone }: { thread: PluginSidebarThread; onDone: () => void }) {
  const actions = experimental_useSidebarThreadActions();
  const [value, setValue] = useState(thread.title ?? thread.displayTitle);
  const commit = () => {
    const next = value.trim();
    if (next !== "" && next !== thread.title) {
      actions.rename(thread.id, next).catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)));
    }
    onDone();
  };
  return (
    <input
      autoFocus
      aria-label="Thread name"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") onDone();
      }}
      className="pointer-events-auto relative z-20 h-6 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

export function ThreadRow({ node, depth }: { node: ThreadNode; depth: number }) {
  const { thread } = node;
  const list = useList();
  const actions = experimental_useSidebarThreadActions();
  const split = experimental_useSidebarThreadSplit(thread.id);
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const [renaming, setRenaming] = useState(false);

  const isActive = list.activeThreadId === thread.id;
  const key = collapseKey.thread(thread.id);
  const hasChildren = node.children.length > 0;
  const collapsed = hasChildren && list.isCollapsed(key);
  const indicator = withDraft(thread.indicator, hasUnsubmittedDraft);
  const entries = threadEntries(thread, actions, split.isAvailable, () => setRenaming(true), list.onNavigate);

  const passive = shortcut ? (
    <kbd className="pointer-events-none inline-flex shrink-0 items-center rounded-sm bg-state-hover px-1.5 py-1 font-sans text-xs leading-none tabular-nums text-subtle-foreground opacity-60">
      {shortcut.label}
    </kbd>
  ) : rowStatusWins(indicator, rowStatus) && rowStatus ? (
    <RowStatusGlyph status={rowStatus} />
  ) : collapsed && rollupIndicator(node.children) !== "none" && indicator === "none" ? (
    <RollupGlyph rollup={rollupIndicator(node.children)} />
  ) : (
    <IndicatorGlyph indicator={indicator} label={thread.indicatorLabel} />
  );

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (renaming) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || event.shiftKey || event.altKey) return;
    if (event.metaKey || event.ctrlKey) {
      if (!split.isAvailable) return;
      event.preventDefault();
      actions.open(thread.id, { split: true });
    } else {
      event.preventDefault();
      actions.open(thread.id);
    }
    list.onNavigate();
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              ROW,
              "group/row h-[var(--bb-sidebar-row-height,1.75rem)] cursor-pointer text-sidebar-foreground",
              isActive
                ? "bb-sidebar-selected-row bg-state-active"
                : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground has-[[data-state=open]]:bg-sidebar-accent",
              !isActive && split.layout !== null && "bb-sidebar-open-in-split-row",
            )}
            style={indent(depth)}
          >
            <a
              href={thread.href}
              draggable={false}
              data-sidebar-thread-shortcut-target=""
              data-sidebar-thread-id={thread.id}
              aria-label={hasUnsubmittedDraft ? `Open ${thread.displayTitle} (unsubmitted draft)` : `Open ${thread.displayTitle}`}
              aria-current={isActive ? "page" : undefined}
              aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
              onClick={onClick}
              onDoubleClick={(event) => {
                event.preventDefault();
                setRenaming(true);
              }}
              {...split.splitProps}
              className="absolute inset-0 rounded-md outline-none ring-sidebar-ring focus-visible:ring-2"
            />
            <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-1.5 self-stretch">
              {renaming ? (
                <RenameField thread={thread} onDone={() => setRenaming(false)} />
              ) : (
                <span className="bb-thread-title min-w-0 truncate" title={thread.displayTitle}>
                  <ThreadTitle threadId={thread.id} />
                </span>
              )}
              {hasChildren && !renaming ? (
                <span className="pointer-events-auto">
                  <Chevron
                    collapsed={collapsed}
                    onToggle={() => list.toggle(key)}
                    label={`${thread.displayTitle} threads`}
                    revealOnHover={!collapsed}
                  />
                </span>
              ) : null}
            </span>
            {renaming ? null : (
              <Trailing
                passive={passive}
                actions={
                  <>
                    <HoverButton label="Archive thread" icon="Archive" onClick={() => actions.archive(thread.id)} />
                    <MoreMenu label="Thread actions" entries={entries} />
                  </>
                }
              />
            )}
          </div>
        </ContextMenuTrigger>
        <ContextEntries entries={entries} />
      </ContextMenu>
      {collapsed ? null : node.children.map((child) => <ThreadRow key={child.thread.id} node={child} depth={depth + 1} />)}
    </>
  );
}
