/**
 * Pure naming pipeline: session entries in, session title out.
 * No pi imports beyond types, so `/sn eval` can replay old sessions through it.
 */

export interface NamingConfig {
  /** Max words a generated title may have. */
  maxWords: number;
  /** Max characters for any name, generated or heuristic. */
  maxLength: number;
  /** Below this word count the first user message is too thin to name from alone. */
  thinInputWords: number;
  /** How many exchanges to read when the first message is thin. */
  maxExchanges: number;
}

export const DEFAULTS: NamingConfig = {
  maxWords: 6,
  maxLength: 60,
  thinInputWords: 15,
  maxExchanges: 3,
};

interface EntryLike {
  type: string;
  message?: { role?: unknown; content?: unknown };
}

/** Tags whose whole body is injected context, not something the user typed. */
const INJECTED_TAGS = [
  "skill",
  "available_skills",
  "system-reminder",
  "task-notification",
  "user-prompt-submit-hook",
  "local-command-stdout",
  "local-command-stderr",
  "command-message",
  "command-name",
  "command-args",
];

const REASONING_TAGS = ["think", "thinking", "reasoning", "reason", "analysis"];

export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: string; text: string } =>
        typeof b === "object" &&
        b !== null &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    )
    .map((b) => b.text)
    .join("\n");
}

/** Strip injected context blocks and pasted dumps so only the user's own words remain. */
export function stripInjected(text: string): string {
  let out = text;
  for (const tag of INJECTED_TAGS) {
    out = out.replace(new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
    // An unclosed injected block runs to the end of the message.
    out = out.replace(new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*$`, "gi"), " ");
  }
  // Pasted file dumps: fenced blocks are context, not intent, once they get long.
  out = out.replace(/```[\s\S]*?```/g, (block) => (block.split("\n").length > 6 ? " " : block));
  return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Cleaned text of each user message in the branch, oldest first, empties dropped. */
function userTexts(branch: readonly EntryLike[]): string[] {
  const texts: string[] = [];
  for (const entry of branch) {
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    const text = stripInjected(contentToText(entry.message.content));
    if (text) texts.push(text);
  }
  return texts;
}

/** Text of each assistant message in the branch, oldest first, empties dropped. */
function assistantTexts(branch: readonly EntryLike[]): string[] {
  const texts: string[] = [];
  for (const entry of branch) {
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    const text = contentToText(entry.message.content).trim();
    if (text) texts.push(text);
  }
  return texts;
}

/**
 * The transcript the namer reads: the first exchange, widened to a few more
 * when the opening message is too thin to name from ("continue", "fix it").
 */
export function buildNamingInput(branch: readonly EntryLike[], config: NamingConfig): string | null {
  const users = userTexts(branch);
  if (users.length === 0) return null;

  const exchanges =
    wordCount(users[0]!) >= config.thinInputWords ? 1 : Math.min(config.maxExchanges, users.length);
  const assistants = assistantTexts(branch);

  const lines: string[] = [];
  for (let i = 0; i < exchanges; i++) {
    lines.push(`User: ${truncate(users[i]!, 1000)}`);
    const reply = assistants[i];
    if (reply) lines.push(`Assistant: ${truncate(reply, 500)}`);
  }
  return lines.join("\n\n");
}

export function systemPrompt(config: NamingConfig): string {
  return [
    "You title coding-agent sessions so they can be told apart in a session list.",
    `Reply with ONLY the title: 3 to ${config.maxWords} words, action first, then the specific object.`,
    'Good: "Fix session-name thinking leak", "Grill on wayfinder ticket flow", "Add retry to backfill job".',
    'Bad: "Debugging session", "Help with code", "User asks about extension" — too vague or narrating.',
    "Name what the session is about, not the tools or skills it loaded.",
    "No quotes, no trailing punctuation, no explanation, no preamble.",
  ].join("\n");
}

export function userPrompt(transcript: string): string {
  return `Session transcript:\n\n${transcript}\n\nTitle:`;
}

/** Drop reasoning wrappers. Returns "" when the whole response was reasoning. */
export function stripReasoning(raw: string): string {
  let out = raw;
  for (const tag of REASONING_TAGS) {
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }
  // An unclosed opener with a closer left over: everything before the closer is reasoning.
  const closer = out.match(new RegExp(`<\\/(?:${REASONING_TAGS.join("|")})>`, "i"));
  if (closer?.index !== undefined) out = out.slice(closer.index + closer[0].length);
  // A dangling opener with no closer means the reply never left reasoning.
  if (new RegExp(`<(?:${REASONING_TAGS.join("|")})>`, "i").test(out)) return "";
  return out.trim();
}

/** Reasoning models often narrate before answering; these never start a real title. */
const NARRATION = /^(okay|ok|alright|so|well|let me|let's|the user|user (wants|asks)|i (will|should|need)|here('s| is)|title:)\b/i;

/**
 * Parse a model response into a title, or null if nothing usable survives.
 * Scanning backwards handles reasoning models that think out loud in plain
 * text before answering: the answer is the last line that looks like a title.
 */
export function parseTitle(raw: string, config: NamingConfig): string | null {
  const stripped = stripReasoning(raw);
  if (!stripped) return null;

  const lines = stripped.split("\n").map((l) => l.trim()).filter(Boolean);
  // Only the tail: a title-shaped line deep inside a wall of reasoning is a
  // stray thought, not the answer.
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
    const candidate = lines[i]!
      .replace(/^#+\s*/, "")
      .replace(/^title:\s*/i, "")
      .replace(/\*\*/g, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?,;:]+$/, "")
      .trim();
    const title = validateTitle(candidate, config);
    if (title) return title;
  }
  return null;
}

/** A title that breaks the format bar is a failed generation, not something to truncate. */
export function validateTitle(title: string, config: NamingConfig): string | null {
  if (!title) return null;
  if (title.length > config.maxLength) return null;
  if (/[<>{}]/.test(title)) return null;
  if (NARRATION.test(title)) return null;
  const words = wordCount(title);
  if (words < 2 || words > config.maxWords) return null;
  return title;
}

/** Last-resort name once generation has failed its budget: the user's opening line. */
export function heuristicName(branch: readonly EntryLike[], config: NamingConfig): string | null {
  const first = userTexts(branch)[0];
  if (!first) return null;
  const line = first.split("\n").map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  return truncate(line.replace(/\s+/g, " "), config.maxLength);
}
