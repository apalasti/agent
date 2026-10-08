export function duration(ms: number | null): string {
  if (ms === null || ms < 0) return "–";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function elapsed(startedAt: number | null, endedAt: number | null, now: number): string | null {
  return startedAt === null ? null : duration((endedAt ?? now) - startedAt);
}

export function kTokens(n: number | null): string {
  if (n === null) return "–";
  if (n < 1000) return String(n);
  const k = Math.round(n / 100) / 10;
  return k < 1000 ? `${k}k` : `${Math.round(n / 100_000) / 10}M`;
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const CLAUDE_ID = /^claude-([a-z]+)((?:-\d+)*?)(?:-\d{8})?(\[1m\]|-1m)?$/i;

export function shortModel(model: string | null): string {
  if (!model) return "inherited";
  const id = model.slice(model.lastIndexOf("/") + 1);
  const claude = CLAUDE_ID.exec(id);
  if (!claude) return id;
  const [, family = "", version = "", large] = claude;
  const name = `${family[0]!.toUpperCase()}${family.slice(1)}`;
  return [name, version.slice(1).replaceAll("-", "."), large ? "1M" : ""].filter(Boolean).join(" ");
}
