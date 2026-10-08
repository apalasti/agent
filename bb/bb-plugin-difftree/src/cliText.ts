import type { ChangedFile, TreeResult } from "./contract";
import { scopeLabel } from "./scope";
import { allDirPaths, buildTree, visibleRows, type DirNode, type TreeNode } from "./tree";

const NAME_WIDTH_MAX = 72;

const KIND_LETTER: Record<ChangedFile["changeKind"], string> = {
  added: "A",
  copied: "C",
  deleted: "D",
  modified: "M",
  renamed: "R",
  type_changed: "T",
};

function expandedToDepth(root: DirNode, depth: number | null): Set<string> {
  if (depth === null) return allDirPaths(root);
  const expanded = new Set<string>();
  const walk = (dir: DirNode, level: number) => {
    if (level + 1 >= depth) return;
    for (const child of dir.children) {
      if (child.kind !== "dir") continue;
      expanded.add(child.path);
      walk(child, level + 1);
    }
  };
  walk(root, 0);
  return expanded;
}

function label(node: TreeNode): string {
  if (node.kind === "dir") return `${node.name}/`;
  const { file } = node;
  const letter = file.untracked ? "?" : KIND_LETTER[file.changeKind];
  const renamed = file.previousPath !== null && file.previousPath !== file.path ? ` ← ${file.previousPath}` : "";
  return `${letter} ${node.name}${renamed}`;
}

function clip(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

export function renderTreeText(result: TreeResult, opts: { depth: number | null; maxLines: number }): string {
  if (result.outcome !== "available") return result.message;

  const { totals } = result;
  const header = [
    result.currentBranch ?? "(detached)",
    scopeLabel(result.scope),
    `${totals.files} file${totals.files === 1 ? "" : "s"} +${totals.additions} -${totals.deletions}`,
  ].join(" · ");
  const lines = [header];
  if (result.truncated) lines.push(`bb capped the list at ${totals.files} files; totals cover only those.`);
  if (result.files.length === 0) {
    lines.push("No changes.");
    return lines.join("\n");
  }

  const root = buildTree(result.files);
  const rows = visibleRows(root, expandedToDepth(root, opts.depth));
  const shown = rows.length > opts.maxLines ? rows.slice(0, Math.max(0, opts.maxLines - 1)) : rows;

  const addedWidth = String(root.additions).length + 1;
  const removedWidth = String(root.deletions).length + 1;
  const names = shown.map(({ node, depth }) => "  ".repeat(depth) + label(node));
  const nameWidth = Math.min(NAME_WIDTH_MAX, Math.max(...names.map((name) => name.length)));

  shown.forEach(({ node }, index) => {
    const name = clip(names[index]!, nameWidth).padEnd(nameWidth);
    const stats =
      node.kind === "file" && node.file.binary
        ? "binary".padStart(addedWidth + 1 + removedWidth)
        : `${`+${node.additions}`.padStart(addedWidth)} ${`-${node.deletions}`.padStart(removedWidth)}`;
    lines.push(`${name}  ${stats}`);
  });
  if (shown.length < rows.length) lines.push(`… ${rows.length - shown.length} more rows`);
  return lines.join("\n");
}
