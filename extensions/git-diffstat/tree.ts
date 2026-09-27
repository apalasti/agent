export interface DirNode {
  kind: "dir";
  name: string;
  path: string;
  added: number;
  removed: number;
  children: TreeNode[];
}

export interface FileNode {
  kind: "file";
  name: string;
  path: string;
  added: number;
  removed: number;
  binary: boolean;
}

export type TreeNode = DirNode | FileNode;

export interface FileChange {
  path: string;
  added: number;
  removed: number;
  binary: boolean;
}

export interface VisibleRow {
  node: TreeNode;
  depth: number;
}

/** Parses `git diff --numstat -z --no-renames` output. */
export function parseNumstat(output: string): FileChange[] {
  return output
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const [added, removed, ...rest] = record.split("\t");
      const binary = added === "-";
      return {
        path: rest.join("\t"),
        added: binary ? 0 : Number(added),
        removed: binary ? 0 : Number(removed),
        binary,
      };
    });
}

export function buildTree(changes: FileChange[]): DirNode {
  const root: DirNode = { kind: "dir", name: "", path: "", added: 0, removed: 0, children: [] };

  for (const change of changes) {
    const parts = change.path.split("/");
    let dir = root;
    dir.added += change.added;
    dir.removed += change.removed;

    for (const part of parts.slice(0, -1)) {
      let next = dir.children.find((c): c is DirNode => c.kind === "dir" && c.name === part);
      if (!next) {
        const path = dir.path ? `${dir.path}/${part}` : part;
        next = { kind: "dir", name: part, path, added: 0, removed: 0, children: [] };
        dir.children.push(next);
      }
      next.added += change.added;
      next.removed += change.removed;
      dir = next;
    }

    dir.children.push({ kind: "file", name: parts.at(-1)!, ...change });
  }

  compressChains(root);
  sortTree(root);
  return root;
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
  dir.children.sort(
    (a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1),
  );
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
