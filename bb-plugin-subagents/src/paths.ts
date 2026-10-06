export const SUMMARY_DISPLAY_LIMIT = 120;

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Absolute directories paths are shown relative to, longest first; macOS's `/tmp` ↔ `/private/tmp` both count. */
export function pathRoots(dirs: readonly (string | null | undefined)[]): string[] {
  const roots = new Set<string>();
  for (const dir of dirs) {
    if (!dir?.startsWith("/") || dir === "/") continue;
    const root = trimSlash(dir);
    roots.add(root);
    if (root.startsWith("/private/")) roots.add(root.slice("/private".length));
    else if (/^\/(?:tmp|var|etc)(?:\/|$)/.test(root)) roots.add(`/private${root}`);
  }
  return [...roots].sort((a, b) => b.length - a.length);
}

/** `path` relative to the first root it lies under, else unchanged. */
export function relativePath(path: string, roots: readonly string[]): string {
  for (const root of roots) {
    if (path === root) return ".";
    if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  }
  return path;
}

export function resolvePath(path: string, cwd: string | null): string {
  if (path.startsWith("/") || cwd === null) return path;
  const parts = trimSlash(cwd).split("/");
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/") || "/";
}

const unquote = (text: string) => text.replace(/^(['"])(.*)\1$/, "$2");
const basename = (path: string) => trimSlash(path).split("/").pop() ?? path;
const LEADING_CD = /^((?:\w+: )?)cd ('[^']*'|"[^"]*"|\S+)\s*(?:&&|;)\s*/;

/** Drops a leading `cd <root> &&`, abbreviates other `cd` targets, and shows paths under a root relative to it. */
export function shortenSummary(summary: string, roots: readonly string[]): string {
  let text = summary;
  const cd = LEADING_CD.exec(text);
  if (cd !== null) {
    const [whole, prefix = "", rawDir = ""] = cd;
    const dir = trimSlash(unquote(rawDir));
    const rest = text.slice(whole.length);
    if (roots.includes(dir)) text = `${prefix}${rest}`;
    else if (dir.startsWith("/") && dir.includes("/", 1)) text = `${prefix}cd …/${basename(dir)} && ${rest}`;
  }
  for (const root of roots) {
    const pattern = new RegExp(`(^|[\\s'"=:(])${escape(root)}(?:/([^\\s'"]*))?(?=[\\s'"):;]|$)`, "g");
    text = text.replace(pattern, (_match, before: string, rest: string | undefined) => `${before}${rest || "."}`);
  }
  return text;
}
