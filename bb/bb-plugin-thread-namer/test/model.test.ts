import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { complete, resolvePi } from "../src/model.ts";

function fakePi(script: string, dir = mkdtempSync(join(tmpdir(), "fake-pi-"))): string {
  const path = join(dir, "pi");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

const ISOLATION = "-p --no-session --no-tools --no-skills --no-context-files --no-prompt-templates --no-themes --no-mcp --offline";

describe("complete", () => {
  it("loads all extensions when none are configured, with the user prompt on stdin", async () => {
    const piPath = fakePi(`echo "args: $*"; echo "stdin: $(cat)"`);
    const out = await complete({ piPath, model: "m", extensions: [] }, "SYS", "USER", AbortSignal.timeout(5000));
    expect(out).toContain(`args: ${ISOLATION} --model m --system-prompt SYS\n`);
    expect(out).toContain("stdin: USER");
  });

  it("loads only the configured extensions", async () => {
    const piPath = fakePi(`echo "args: $*"`);
    const out = await complete(
      { piPath, model: "m", extensions: ["/a.ts", "/b.ts"] },
      "SYS",
      "USER",
      AbortSignal.timeout(5000),
    );
    expect(out).toContain(`args: ${ISOLATION} --no-extensions -e /a.ts -e /b.ts --model m --system-prompt SYS\n`);
  });

  it("rejects with stderr when pi exits non-zero", async () => {
    const piPath = fakePi(`echo "No API key" >&2; exit 1`);
    await expect(complete({ piPath, model: "m", extensions: [] }, "s", "u", AbortSignal.timeout(5000))).rejects.toThrow(
      "pi exited 1: No API key",
    );
  });
});

describe("resolvePi", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("finds pi in ~/.pi/agent/bin when it is not on PATH", () => {
    const home = mkdtempSync(join(tmpdir(), "fake-home-"));
    const bin = join(home, ".pi/agent/bin");
    mkdirSync(bin, { recursive: true });
    const path = fakePi("", bin);
    vi.stubEnv("HOME", home);
    vi.stubEnv("PATH", "");
    expect(resolvePi("pi")).toBe(path);
  });

  it("returns a configured path unchanged", () => {
    expect(resolvePi("/opt/pi")).toBe("/opt/pi");
  });
});
