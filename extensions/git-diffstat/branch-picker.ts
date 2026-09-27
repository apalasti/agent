import { Input, fuzzyFilter, getKeybindings, truncateToWidth } from "@earendil-works/pi-tui";

const WINDOW = 12;

/** Branch list narrowed by fuzzy search as you type. */
export class BranchPickerComponent {
  private readonly input = new Input();
  private matches: string[];
  private cursor = 0;
  private offset = 0;

  constructor(
    private readonly tui: any,
    private readonly theme: any,
    private readonly title: string,
    private readonly branches: string[],
    private readonly finish: (branch: string | undefined) => void,
  ) {
    this.matches = branches;
  }

  get focused(): boolean {
    return this.input.focused;
  }

  set focused(value: boolean) {
    this.input.focused = value;
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const t = this.theme;
    if (this.cursor < this.offset) this.offset = this.cursor;
    if (this.cursor >= this.offset + WINDOW) this.offset = this.cursor - WINDOW + 1;

    const out = [
      t.fg("border", "─".repeat(Math.max(1, width))),
      t.fg("accent", t.bold(this.title)),
      ...this.input.render(width),
      "",
    ];

    if (this.matches.length === 0) out.push(t.fg("dim", "  no matching branch"));
    this.matches.slice(this.offset, this.offset + WINDOW).forEach((branch, i) => {
      const selected = this.offset + i === this.cursor;
      const row = selected ? t.fg("accent", `→ ${branch}`) : `  ${branch}`;
      out.push(truncateToWidth(row, width));
    });

    if (this.matches.length > WINDOW) {
      const shown = `${this.offset + 1}–${Math.min(this.offset + WINDOW, this.matches.length)} of ${this.matches.length}`;
      out.push(t.fg("dim", `  ${shown}`));
    }
    out.push("", t.fg("muted", "type to filter · ↑↓ move · ⏎ select · esc cancel"));
    out.push(t.fg("border", "─".repeat(Math.max(1, width))));
    return out;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();

    if (kb.matches(data, "tui.select.up")) {
      this.cursor = Math.max(0, this.cursor - 1);
    } else if (kb.matches(data, "tui.select.down")) {
      this.cursor = Math.min(this.matches.length - 1, this.cursor + 1);
    } else if (kb.matches(data, "tui.select.confirm") || data === "\n") {
      const branch = this.matches[this.cursor];
      if (branch) this.finish(branch);
      return;
    } else if (kb.matches(data, "tui.select.cancel")) {
      this.finish(undefined);
      return;
    } else {
      this.input.handleInput(data);
      this.matches = fuzzyFilter(this.branches, this.input.getValue(), (b) => b);
      this.cursor = 0;
    }

    this.tui.requestRender();
  }
}
