export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/** `blocked-by: [02, 05]` or `blocked-by: 02, 05` or `blocked-by: []` */
export function parseBlockedBy(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((n) => n.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** The file's name is its `# ` heading; the slug is the fallback. */
export function parseTitle(content: string, slug: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : slug;
}

export function numberOf(slug: string): string {
  return slug.match(/^(\d+)/)?.[1] ?? slug;
}
