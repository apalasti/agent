export function duration(ms: number | null): string {
  if (ms === null || ms < 0) return "–";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function kTokens(n: number | null): string {
  if (n === null) return "–";
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function shortModel(model: string | null): string {
  if (!model) return "inherited";
  const name = model.replace(/^claude-/, "").replace(/-\d{8}(?=$|\[)/, "");
  const versioned = name.replace(/-(\d+)-(\d+)(?=$|\[)/, " $1.$2");
  return versioned === name ? name.replace(/-(\d+)(?=$|\[)/, " $1") : versioned;
}

export function workspacePath(path: string, cwd: string | null): string | null {
  return cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : null;
}

export function relPath(path: string, cwd: string | null): string {
  return workspacePath(path, cwd) ?? path.replace(/^\/Users\/[^/]+/, "~");
}
