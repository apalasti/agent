/**
 * Paste Detector Extension - Detects pasted code snippets and replaces them with file references.
 *
 * When you paste code into the editor, this extension:
 * 1. Detects the paste immediately via the bracketed paste escape sequence
 * 2. Shows the pasted text in the editor right away (no delay)
 * 3. Searches the codebase using ripgrep (respects .gitignore)
 * 4. If found, replaces it in the editor with "[Found in file:path line:start-end]"
 * 5. If not found, leaves the pasted text unchanged
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface SearchResult {
  file: string;
  line: number;
}

const PASTE_START = "\x1b[200~"; // bracketed paste start marker
const PASTE_END = "\x1b[201~";   // bracketed paste end marker

class PasteDetectorEditor extends CustomEditor {
  constructor(
    tui: any,
    theme: any,
    keybindings: any,
    private piRef: ExtensionAPI,
    private ui: any,
  ) {
    super(tui, theme, keybindings);
  }

  handleInput(data: string): void {
    // Detect bracketed paste sequence sent by the terminal on Cmd+V / Ctrl+Shift+V
    if (data.startsWith(PASTE_START)) {
      const endIdx = data.indexOf(PASTE_END);
      let pastedText = endIdx !== -1
        ? data.slice(PASTE_START.length, endIdx)
        : data.slice(PASTE_START.length);

      // Normalize line endings (handle \r\n, \r, and \n)
      pastedText = pastedText.replace(/\r\n|\r/g, "\n");

      // Let the paste through immediately so the editor feels responsive
      super.handleInput(data);

      // Only search for multi-line snippets (single lines are likely not code)
      if (pastedText.includes("\n") && pastedText.length > 10) {
        this.searchAndReplace(pastedText);
      }
      return;
    }

    super.handleInput(data);
  }

  private async searchAndReplace(pastedText: string) {
    try {
      const result = await findCodeInRepository(pastedText, this.piRef);

      if (result) {
        const lineCount = pastedText.split("\n").length;
        const endLine = result.line + lineCount - 1;
        const reference = `[Found in ${result.file}:${result.line}-${endLine}]`;

        // Replace the pasted text with the reference in the editor
        const currentText = this.ui.getEditorText();
        const newText = currentText.replace(pastedText, reference);
        this.ui.setEditorText(newText);
        this.ui.notify(`✓ Found in codebase — replaced with reference`, "info");
      }
    } catch (error) {
      // Silently fail
    }
  }
}

async function findCodeInRepository(
  pastedText: string,
  pi: ExtensionAPI,
): Promise<SearchResult | null> {
  try {
    const searchQuery = pastedText.slice(0, 500).trim();

    if (searchQuery.length < 10) {
      return null;
    }

    const result = await pi.exec("rg", [
      "-U",              // multiline mode — allow \n in pattern
      "-F",              // fixed string, no regex
      "-n",              // show line numbers
      "-H",              // show filenames
      "--no-heading",
      "--max-count", "1",
      "--color", "never",
      searchQuery,
    ]);

    if (result.code !== 0 || !result.stdout) return null;

    // Output format: "path/to/file.ts:42:matched line"
    const firstLine = result.stdout.trim().split("\n")[0];
    if (!firstLine) return null;

    const parts = firstLine.split(":");
    if (parts.length < 2) return null;

    const file = parts[0]!;
    const lineNum = parseInt(parts[1]!, 10);
    if (isNaN(lineNum)) return null;

    return { file, line: lineNum };
  } catch (error) {
    return null;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      new PasteDetectorEditor(tui, theme, keybindings, pi, ctx.ui)
    );
  });
}
