import { getKeybindings, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { visibleRows, type DirNode, type TreeNode } from "./tree.ts";

const WINDOW = 20;

/** Diff tree rooted at the repo root; space expands a folder in place instead of entering it. */
export class DiffTreeComponent {
  private readonly expanded = new Set<string>();
  private cursor = 0;
  private offset = 0;

  constructor(
    private readonly tui: any,
    private readonly theme: any,
    private readonly title: string,
    private readonly root: DirNode,
    private readonly close: () => void,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const t = this.theme;
    const rows = visibleRows(this.root, this.expanded);
    if (this.cursor < this.offset) this.offset = this.cursor;
    if (this.cursor >= this.offset + WINDOW) this.offset = this.cursor - WINDOW + 1;

    const addedWidth = String(this.root.added).length + 1;
    const removedWidth = String(this.root.removed).length + 1;
    const stats = (node: TreeNode) => {
      if (node.kind === "file" && node.binary) {
        return t.fg("dim", "binary".padStart(addedWidth + 1 + removedWidth));
      }
      return (
        t.fg("toolDiffAdded", `+${node.added}`.padStart(addedWidth)) +
        " " +
        t.fg("toolDiffRemoved", `-${node.removed}`.padStart(removedWidth))
      );
    };
    const statsWidth = addedWidth + 1 + removedWidth;

    const line = (left: string, right: string) => {
      const room = Math.max(1, width - statsWidth - 1);
      const name = truncateToWidth(left, room);
      return name + " ".repeat(Math.max(1, width - visibleWidth(name) - statsWidth)) + right;
    };

    const out = [
      t.fg("border", "─".repeat(Math.max(1, width))),
      line(t.fg("accent", t.bold(this.title)), stats(this.root)),
      "",
    ];

    rows.slice(this.offset, this.offset + WINDOW).forEach(({ node, depth }, i) => {
      const selected = this.offset + i === this.cursor;
      const marker = selected ? t.fg("accent", "→ ") : "  ";
      const indent = "  ".repeat(depth);
      const label =
        node.kind === "dir"
          ? `${this.expanded.has(node.path) ? "▾" : "▸"} ${node.name}/`
          : `  ${node.name}`;
      const color = selected ? "accent" : node.kind === "dir" ? "text" : "muted";
      out.push(line(marker + indent + t.fg(color, label), stats(node)));
    });

    if (rows.length > WINDOW) {
      const shown = `${this.offset + 1}–${Math.min(this.offset + WINDOW, rows.length)} of ${rows.length}`;
      out.push(t.fg("dim", `  ${shown}`));
    }
    out.push("", t.fg("muted", "↑↓ move · space expand/collapse · esc close"));
    out.push(t.fg("border", "─".repeat(Math.max(1, width))));
    return out;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();
    const rows = visibleRows(this.root, this.expanded);

    if (kb.matches(data, "tui.select.up") || data === "k") {
      this.cursor = Math.max(0, this.cursor - 1);
    } else if (kb.matches(data, "tui.select.down") || data === "j") {
      this.cursor = Math.min(rows.length - 1, this.cursor + 1);
    } else if (data === " ") {
      const node = rows[this.cursor]?.node;
      if (node?.kind !== "dir") return;
      if (this.expanded.has(node.path)) this.expanded.delete(node.path);
      else this.expanded.add(node.path);
    } else if (kb.matches(data, "tui.select.cancel") || data === "q") {
      this.close();
      return;
    } else {
      return;
    }

    this.tui.requestRender();
  }
}
