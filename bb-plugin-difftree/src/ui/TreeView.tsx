import { Fragment, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ChangedFile, Scope } from "../contract";
import { allDirPaths, buildTree, filterFiles, initialExpanded, visibleRows, type DirNode, type TreeNode } from "../tree";
import { FilePatch } from "./FilePatch";
import { statsWidths } from "./Stats";
import { TreeRow } from "./TreeRow";

export const INITIAL_ROW_BUDGET = 40;

export interface TreeController {
  expandAll(): void;
  collapseAll(): void;
  focusFirstRow(): void;
}

function toggled(set: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(set);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/** Expansion follows `initialExpanded` until the user opens or closes a folder; while filtering, every matching folder is open unless closed. */
function useExpansion(fullRoot: DirNode, root: DirNode, query: string) {
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [closedWhileFiltering, setClosedWhileFiltering] = useState<{ query: string; paths: Set<string> }>({
    query: "",
    paths: new Set(),
  });
  const filtering = query.trim() !== "";
  const automatic = useMemo(() => initialExpanded(fullRoot, INITIAL_ROW_BUDGET), [fullRoot]);
  const closed = useMemo(
    () => (closedWhileFiltering.query === query ? closedWhileFiltering.paths : new Set<string>()),
    [closedWhileFiltering, query],
  );

  const expanded = useMemo(() => {
    if (!filtering) return chosen ?? automatic;
    const open = allDirPaths(root);
    for (const path of closed) open.delete(path);
    return open;
  }, [filtering, chosen, automatic, root, closed]);

  const setClosed = (paths: Set<string>) => setClosedWhileFiltering({ query, paths });
  return {
    expanded,
    toggle(path: string) {
      if (filtering) setClosed(toggled(closed, path));
      else setChosen(toggled(expanded, path));
    },
    expandAll() {
      if (filtering) setClosed(new Set());
      else setChosen(allDirPaths(root));
    },
    collapseAll() {
      if (filtering) setClosed(allDirPaths(root));
      else setChosen(new Set());
    },
  };
}

export function TreeView({
  threadId,
  environmentId,
  scope,
  files,
  query,
  controllerRef,
}: {
  threadId: string;
  environmentId: string;
  scope: Scope;
  files: readonly ChangedFile[];
  query: string;
  controllerRef: { current: TreeController | null };
}) {
  const navigate = useBbNavigate();
  const fullRoot = useMemo(() => buildTree(files), [files]);
  const root = useMemo(() => (query.trim() === "" ? fullRoot : buildTree(filterFiles(files, query))), [files, fullRoot, query]);
  const expansion = useExpansion(fullRoot, root, query);
  const rows = useMemo(() => visibleRows(root, expansion.expanded), [root, expansion.expanded]);
  const widths = statsWidths(fullRoot.additions, fullRoot.deletions);

  const [openPatches, setOpenPatches] = useState<Set<string>>(new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const rowElements = useRef(new Map<string, HTMLDivElement>());

  const focusedIndex = Math.max(0, rows.findIndex((row) => row.node.path === focusedPath));
  const focusRow = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (row) rowElements.current.get(row.node.path)?.focus();
  };

  controllerRef.current = {
    expandAll: expansion.expandAll,
    collapseAll: expansion.collapseAll,
    focusFirstRow: () => focusRow(focusedIndex),
  };

  const toggle = (node: TreeNode) => {
    if (node.kind === "dir") expansion.toggle(node.path);
    else setOpenPatches((open) => toggled(open, node.path));
  };

  const openFile = (node: TreeNode) =>
    navigate.experimental_openFilePreview({ target: { kind: "workspace", environmentId, path: node.path }, location: null });

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const { node, depth } = rows[index]!;
    const isOpenDir = node.kind === "dir" && expansion.expanded.has(node.path);
    switch (event.key) {
      case "ArrowDown":
        focusRow(index + 1);
        break;
      case "ArrowUp":
        focusRow(index - 1);
        break;
      case "Home":
        focusRow(0);
        break;
      case "End":
        focusRow(rows.length - 1);
        break;
      case "ArrowRight":
        if (node.kind !== "dir") return;
        if (isOpenDir) focusRow(index + 1);
        else expansion.toggle(node.path);
        break;
      case "ArrowLeft": {
        if (isOpenDir) {
          expansion.toggle(node.path);
          break;
        }
        let parent = index - 1;
        while (parent >= 0 && rows[parent]!.depth >= depth) parent--;
        if (parent >= 0) focusRow(parent);
        break;
      }
      case "Enter":
      case " ":
        toggle(node);
        break;
      case "o":
        if (node.kind === "file" && node.file.changeKind !== "deleted") openFile(node);
        else return;
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  if (rows.length === 0) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">No changed file matches “{query.trim()}”.</p>;
  }

  return (
    <div role="tree" aria-label="Changed files" className="pb-2">
      {rows.map(({ node, depth }, index) => {
        const open = node.kind === "dir" ? expansion.expanded.has(node.path) : openPatches.has(node.path);
        const canOpen = node.kind === "file" && node.file.changeKind !== "deleted";
        const row = (
          <TreeRow
            node={node}
            depth={depth}
            open={open}
            focusable={index === focusedIndex}
            widths={widths}
            rowRef={(element) => {
              if (element) rowElements.current.set(node.path, element);
              else rowElements.current.delete(node.path);
            }}
            onToggle={() => {
              setFocusedPath(node.path);
              toggle(node);
            }}
            onFocus={() => setFocusedPath(node.path)}
            onKeyDown={onKeyDown(index)}
            onOpenFile={canOpen ? () => openFile(node) : null}
          />
        );
        // The wrapper scopes the open row's sticky pinning to its own patch: the path stays
        // readable while a long patch scrolls under it, and unsticks once the patch passes.
        if (node.kind === "file" && open) {
          return (
            <div key={`${node.kind}:${node.path}`}>
              {row}
              <FilePatch threadId={threadId} scope={scope} file={node.file} />
            </div>
          );
        }
        return <Fragment key={`${node.kind}:${node.path}`}>{row}</Fragment>;
      })}
    </div>
  );
}
