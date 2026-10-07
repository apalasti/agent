import type { ChangedFile } from "./contract";

export interface DirNode {
  kind: "dir";
  /** Display name; a compressed chain reads "frontend/src". */
  name: string;
  /** Path of the deepest directory in the chain; the key for expansion state. */
  path: string;
  additions: number;
  deletions: number;
  fileCount: number;
  children: TreeNode[];
}

export interface FileNode {
  kind: "file";
  name: string;
  path: string;
  additions: number;
  deletions: number;
  file: ChangedFile;
}

export type TreeNode = DirNode | FileNode;

export interface VisibleRow {
  node: TreeNode;
  depth: number;
}

export function buildTree(files: readonly ChangedFile[]): DirNode {
  const root: DirNode = { kind: "dir", name: "", path: "", additions: 0, deletions: 0, fileCount: 0, children: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let dir = root;
    count(dir, file);

    for (const part of parts.slice(0, -1)) {
      let next = dir.children.find((c): c is DirNode => c.kind === "dir" && c.name === part);
      if (!next) {
        const path = dir.path ? `${dir.path}/${part}` : part;
        next = { kind: "dir", name: part, path, additions: 0, deletions: 0, fileCount: 0, children: [] };
        dir.children.push(next);
      }
      count(next, file);
      dir = next;
    }

    dir.children.push({
      kind: "file",
      name: parts.at(-1)!,
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      file,
    });
  }

  compressChains(root);
  sortTree(root);
  return root;
}

function count(dir: DirNode, file: ChangedFile): void {
  dir.additions += file.additions;
  dir.deletions += file.deletions;
  dir.fileCount += 1;
}

function compressChains(dir: DirNode): void {
  dir.children = dir.children.map((child) => {
    if (child.kind === "file") return child;
    let merged = child;
    while (merged.children.length === 1 && merged.children[0]!.kind === "dir") {
      const only = merged.children[0] as DirNode;
      merged = { ...only, name: `${merged.name}/${only.name}` };
    }
    compressChains(merged);
    return merged;
  });
}

function sortTree(dir: DirNode): void {
  dir.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
  for (const child of dir.children) if (child.kind === "dir") sortTree(child);
}

export function visibleRows(root: DirNode, expanded: ReadonlySet<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (dir: DirNode, depth: number) => {
    for (const node of dir.children) {
      rows.push({ node, depth });
      if (node.kind === "dir" && expanded.has(node.path)) walk(node, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** Case-insensitive substring match on the path, old path included for renames. */
export function filterFiles(files: readonly ChangedFile[], query: string): ChangedFile[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...files];
  return files.filter(
    (file) => file.path.toLowerCase().includes(needle) || (file.previousPath?.toLowerCase().includes(needle) ?? false),
  );
}

/** Opens folders breadth-first while the visible row count stays within `budget`. */
export function initialExpanded(root: DirNode, budget: number): Set<string> {
  const expanded = new Set<string>();
  let visible = root.children.length;
  let frontier = root.children.filter((c): c is DirNode => c.kind === "dir");
  while (frontier.length > 0) {
    const next: DirNode[] = [];
    for (const dir of frontier) {
      if (visible + dir.children.length > budget) continue;
      expanded.add(dir.path);
      visible += dir.children.length;
      for (const child of dir.children) if (child.kind === "dir") next.push(child);
    }
    frontier = next;
  }
  return expanded;
}

export function allDirPaths(root: DirNode): Set<string> {
  const paths = new Set<string>();
  const walk = (dir: DirNode) => {
    for (const child of dir.children) {
      if (child.kind !== "dir") continue;
      paths.add(child.path);
      walk(child);
    }
  };
  walk(root);
  return paths;
}
