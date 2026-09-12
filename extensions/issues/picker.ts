import { Container, Spacer, Text, getKeybindings } from "@earendil-works/pi-tui";

export interface PickerRow {
  key: string;
  group: string;
  primary: string;
  secondary: string;
}

const WINDOW = 12;

/** Checkbox list where ticking a row restricts the rest of the selection to that row's group. */
export class MultiSelectComponent extends Container {
  private readonly list = new Container();
  private readonly hint: Text;
  private cursor = 0;
  private offset = 0;
  private readonly checked = new Set<string>();
  private done = false;

  constructor(
    private readonly theme: any,
    title: string,
    private readonly rows: PickerRow[],
    private readonly finish: (result: PickerRow[] | undefined) => void,
  ) {
    super();

    const border = () => ({
      render: (w: number) => [theme.fg("border", "─".repeat(Math.max(1, w)))],
    });

    this.hint = new Text(this.hintLine(), 1, 0);

    this.addChild(border());
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(this.hint);
    this.addChild(new Spacer(1));
    this.addChild(border());

    this.render_();
  }

  private get lockedGroup(): string | undefined {
    for (const row of this.rows) if (this.checked.has(row.key)) return row.group;
    return undefined;
  }

  private hintLine(): string {
    const locked = this.lockedGroup;
    const scope = locked ? `${this.checked.size} in ${locked}` : "none";
    return this.theme.fg("muted", `space toggle · a all · ⏎ run · esc cancel · ${scope}`);
  }

  private step(direction: -1 | 1): void {
    const locked = this.lockedGroup;
    let next = this.cursor + direction;
    while (next >= 0 && next < this.rows.length) {
      if (locked === undefined || this.rows[next]!.group === locked) {
        this.cursor = next;
        return;
      }
      next += direction;
    }
  }

  private render_(): void {
    if (this.cursor < this.offset) this.offset = this.cursor;
    if (this.cursor >= this.offset + WINDOW) this.offset = this.cursor - WINDOW + 1;

    const locked = this.lockedGroup;
    const width = Math.max(...this.rows.map((r) => r.primary.length));
    const visible = this.rows.slice(this.offset, this.offset + WINDOW);

    this.list.clear();

    let lastGroup: string | undefined;
    visible.forEach((row, i) => {
      const index = this.offset + i;
      if (row.group !== lastGroup) {
        lastGroup = row.group;
        this.list.addChild(new Text(this.theme.fg("dim", row.group), 1, 0));
      }

      const disabled = locked !== undefined && row.group !== locked;
      const box = this.checked.has(row.key) ? "[x]" : "[ ]";
      const body = `${box} ${row.primary.padEnd(width)}  ${row.secondary}`;

      const color = disabled ? "dim" : index === this.cursor ? "accent" : "text";
      const marker = index === this.cursor ? this.theme.fg("accent", "→ ") : "  ";
      this.list.addChild(new Text(marker + this.theme.fg(color, body), 1, 0));
    });

    if (this.rows.length > WINDOW) {
      const shown = `${this.offset + 1}–${this.offset + visible.length} of ${this.rows.length}`;
      this.list.addChild(new Text(this.theme.fg("dim", `  ${shown}`), 1, 0));
    }

    this.hint.setText(this.hintLine());
  }

  private toggle(row: PickerRow): void {
    const locked = this.lockedGroup;
    if (locked !== undefined && row.group !== locked) return;
    if (this.checked.has(row.key)) this.checked.delete(row.key);
    else this.checked.add(row.key);
  }

  private toggleAll(): void {
    const group = this.lockedGroup ?? this.rows[this.cursor]?.group;
    if (group === undefined) return;
    const inGroup = this.rows.filter((r) => r.group === group);
    const allChecked = inGroup.every((r) => this.checked.has(r.key));
    for (const row of inGroup) {
      if (allChecked) this.checked.delete(row.key);
      else this.checked.add(row.key);
    }
  }

  handleInput(data: string): void {
    if (this.done) return;
    const kb = getKeybindings();

    if (kb.matches(data, "tui.select.up") || data === "k") {
      this.step(-1);
    } else if (kb.matches(data, "tui.select.down") || data === "j") {
      this.step(1);
    } else if (data === " ") {
      const row = this.rows[this.cursor];
      if (row) this.toggle(row);
    } else if (data === "a") {
      this.toggleAll();
    } else if (kb.matches(data, "tui.select.confirm") || data === "\n") {
      const picked = this.rows.filter((r) => this.checked.has(r.key));
      if (picked.length === 0) return;
      this.done = true;
      this.finish(picked);
      return;
    } else if (kb.matches(data, "tui.select.cancel")) {
      this.done = true;
      this.finish(undefined);
      return;
    } else {
      return;
    }

    this.render_();
  }
}
