import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { complete } from "../src/model.ts";

function fakeClaude(script: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "fake-claude-")), "claude");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("complete", () => {
  it("passes the model and system prompt as flags and the user prompt on stdin", async () => {
    const claudePath = fakeClaude(`echo "args: $*"; echo "stdin: $(cat)"`);
    const out = await complete({ claudePath, model: "haiku" }, "SYS", "USER", AbortSignal.timeout(5000));
    expect(out).toContain("--model haiku --system-prompt SYS --tools");
    expect(out).toContain("stdin: USER");
  });

  it("rejects with stderr when claude exits non-zero", async () => {
    const claudePath = fakeClaude(`echo "Not logged in" >&2; exit 1`);
    await expect(complete({ claudePath, model: "haiku" }, "s", "u", AbortSignal.timeout(5000))).rejects.toThrow(
      "claude exited 1: Not logged in",
    );
  });
});
