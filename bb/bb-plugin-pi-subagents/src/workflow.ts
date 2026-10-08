export type WorkflowMeta = { name: string | null; description: string | null; phases: string[] };
export type Journal = { done: number; failed: number };

const STRING = String.raw`(['"\x60])((?:\\.|(?!\1)[^\\])*)\1`;

function metaBlock(script: string): string | null {
  const start = /export\s+const\s+meta\s*=\s*\{/.exec(script);
  if (!start) return null;
  let depth = 0;
  for (let i = start.index + start[0].length - 1; i < script.length; i++) {
    if (script[i] === "{") depth++;
    else if (script[i] === "}" && --depth === 0) return script.slice(start.index, i + 1);
  }
  return script.slice(start.index);
}

const unescape = (text: string) => text.replace(/\\(.)/g, "$1");

function stringField(block: string, key: string): string | null {
  const match = new RegExp(String.raw`\b${key}\s*:\s*${STRING}`).exec(block);
  return match ? unescape(match[2]!) : null;
}

export function parseMeta(script: string): WorkflowMeta {
  const block = metaBlock(script);
  if (!block) return { name: null, description: null, phases: [] };
  const phases = /\bphases\s*:\s*\[([\s\S]*?)\]/.exec(block)?.[1] ?? "";
  return {
    name: stringField(block, "name"),
    description: stringField(block, "description"),
    phases: [...phases.matchAll(new RegExp(String.raw`\btitle\s*:\s*${STRING}`, "g"))].map((match) => unescape(match[2]!)),
  };
}

export function parseJournal(jsonl: string): Journal {
  const ok = new Map<number, boolean>();
  for (const raw of jsonl.split("\n")) {
    try {
      const entry = JSON.parse(raw) as { index?: unknown; ok?: unknown };
      if (typeof entry.index === "number") ok.set(entry.index, entry.ok === true);
    } catch {
      continue;
    }
  }
  const values = [...ok.values()];
  return { done: values.length, failed: values.filter((value) => !value).length };
}
