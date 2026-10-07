import {
  CATEGORY_ORDER,
  type Category,
  type CategoryId,
  type CategoryKind,
  type ContextReport,
  type CourseChange,
  type Entry,
  type Meter,
  type Segment,
  type Turn,
} from "./contract";
import { estimateTokens, messageKey, oneLine, withoutSenderHeader } from "./estimate";
import { lastChangeSeq, type Timeline, type TurnFact, type UsagePoint } from "./events";
import { apportion } from "./measure";
import type { SessionCompaction, SessionContext, SessionItem } from "./piSession";

export interface SnapshotCategory {
  id: string;
  label: string;
  kind: CategoryKind;
  tokens: number;
  entries: { id: string; label: string; tokens: number }[];
}

export interface ContextSnapshot {
  providerSessionId: string;
  model: string;
  usedTokens: number;
  contextWindowTokens: number;
  autoCompactAtTokens: number | null;
  capturedAt: string;
  categories: SnapshotCategory[];
}

/** `threads.context().usage`. */
export interface ContextUsage {
  usedTokens: number;
  modelContextWindow: number;
  estimated?: boolean;
  snapshot?: ContextSnapshot;
}

export type SessionSourceKind = "pi-session" | "claude-transcript" | "bb-only";

export interface ComposeInput {
  threadId: string;
  providerId: string | null;
  threadStatus: string;
  timeline: Timeline;
  session: SessionContext | null;
  source: { kind: SessionSourceKind; path: string | null };
  usage: ContextUsage | null;
  remote?: boolean;
  /** Calibration factor of this thread's last measured report; scales estimates while `T` is unknown. */
  priorCalibration?: number | null;
  /** Window last seen for this thread or its fork source, for when neither bb nor the events report one. */
  knownWindow?: number | null;
}

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  system: "System prompt",
  tools: "Tool definitions",
  memory: "Memory files",
  skills: "Skills",
  user: "Your messages",
  assistant: "Assistant text",
  thinking: "Thinking",
  toolCalls: "Tool calls",
  toolResults: "Tool results",
  summary: "Compaction summary",
  other: "Other",
  unattributed: "Unattributed",
  reserved: "Autocompact buffer",
  free: "Free space",
  deferred: "Available on demand",
};
const NOT_IN_TRANSCRIPT_LABEL = "System prompt, tools & skills (not in transcript)";

const BASE_CATEGORIES: readonly CategoryId[] = ["system", "tools", "memory", "skills"];
const SNAPSHOT_COVERED = new Set<CategoryId>(BASE_CATEGORIES);
const GROUPED = new Set<CategoryId>(["system", "tools", "memory", "skills", "toolCalls", "toolResults", "other"]);
const RUNNING_STATUSES = new Set(["active", "starting", "stopping", "pending"]);
const CALIBRATION_RANGE = [0.5, 2] as const;
const MAX_ENTRIES = 50;
const MAX_CHILDREN = 10;
const MAX_LARGEST = 10;
const MAX_TURN_LARGEST = 3;
const MAX_TEXT = 8000;
const MAX_PREVIEW = 140;
const MATCH_LOOKBACK = 5;
const MAX_NOTES = 2;

export const isRunning = (status: string) => RUNNING_STATUSES.has(status);

interface Calibrated {
  item: SessionItem;
  tokens: number;
}

function snapshotCategory(category: SnapshotCategory): CategoryId | "messages" {
  if (category.kind === "reserved") return "reserved";
  if (category.kind === "free") return "free";
  if (category.kind === "deferred") return "deferred";
  const label = category.label.toLowerCase();
  if (label === "messages") return "messages";
  if (label.startsWith("system prompt") || label.startsWith("mcp server instructions")) return "system";
  if (label.startsWith("system tools") || label.startsWith("mcp tools")) return "tools";
  if (label.startsWith("memory")) return "memory";
  if (label.startsWith("skills")) return "skills";
  return "other";
}

/** Session user messages matched to bb turns from the end, by order, confirmed by text prefix. */
export function matchTurns(turns: readonly TurnFact[], items: readonly SessionItem[]): Map<number, number> {
  const users = items.filter((item) => item.userText !== undefined && item.userOrdinal !== null);
  const byTurn = new Map<number, number>();
  let cursor = users.length - 1;
  for (let turn = turns.length - 1; turn >= 0 && cursor >= 0; turn--) {
    const key = messageKey((turns[turn] as TurnFact).text).slice(0, 40);
    for (let probe = cursor; probe >= 0 && probe >= cursor - MATCH_LOOKBACK; probe--) {
      const user = users[probe] as SessionItem;
      if (messageKey(user.userText ?? "").slice(0, 40) === key) {
        byTurn.set(turn, user.userOrdinal as number);
        cursor = probe - 1;
        break;
      }
    }
  }
  return byTurn;
}

function toEntry(calibrated: Calibrated, turnOf: (ordinal: number | null) => number | null): Entry {
  const { item, tokens } = calibrated;
  return { id: item.key, label: item.label, detail: item.detail, tokens, turnIndex: turnOf(item.userOrdinal) };
}

const byTokens = <T extends { tokens: number }>(a: T, b: T) => b.tokens - a.tokens;

function buildEntries(calibrated: readonly Calibrated[], category: CategoryId, turnOf: (ordinal: number | null) => number | null): Category["entries"] {
  if (!GROUPED.has(category)) {
    return calibrated
      .map((entry) => ({ ...toEntry(entry, turnOf), children: [] }))
      .sort(byTokens)
      .slice(0, MAX_ENTRIES);
  }
  const groups = new Map<string, Calibrated[]>();
  for (const entry of calibrated) {
    const group = groups.get(entry.item.label) ?? [];
    group.push(entry);
    groups.set(entry.item.label, group);
  }
  const entries: Category["entries"] = [];
  for (const [label, members] of groups) {
    const children = members.map((member) => toEntry(member, turnOf)).sort(byTokens);
    const turns = new Set(children.map((child) => child.turnIndex));
    const single = children.length === 1 ? children[0] : undefined;
    entries.push({
      id: single?.id ?? `${category}:${label}`,
      label,
      detail: single?.detail ?? (children.length > 1 ? `${children.length}×` : null),
      tokens: children.reduce((sum, child) => sum + child.tokens, 0),
      turnIndex: turns.size === 1 ? (children[0]?.turnIndex ?? null) : null,
      children: children.length > 1 ? children.slice(0, MAX_CHILDREN) : [],
    });
  }
  return entries.sort(byTokens).slice(0, MAX_ENTRIES);
}

function categoryKind(id: CategoryId): CategoryKind {
  if (id === "reserved" || id === "free" || id === "deferred") return id;
  return "used";
}

function lastMeasured(points: readonly UsagePoint[]): UsagePoint | undefined {
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index] as UsagePoint;
    if (point.usedTokens !== null) return point;
  }
  return undefined;
}

/** Until the edited session reports, its file may still hold the discarded branch: items after the turn before the edit that match no active turn. */
function withoutDiscarded(items: readonly SessionItem[], timeline: Timeline): readonly SessionItem[] {
  const last = timeline.courseChanges.filter((change) => change.kind !== "compactionSkipped").at(-1);
  if (last?.kind !== "edited") return items;
  const matches = matchTurns(timeline.turns, items);
  const previousTurn = last.beforeTurnIndex - 2;
  const floor = previousTurn < 0 ? -1 : matches.get(previousTurn);
  if (floor === undefined) return items;
  const active = new Set(matches.values());
  return items.filter((item) => item.userOrdinal === null || item.userOrdinal <= floor || active.has(item.userOrdinal));
}

export function composeReport(input: ComposeInput): ContextReport {
  const { timeline, usage } = input;
  const isClaude = input.source.kind === "claude-transcript";
  const snapshot =
    isClaude && usage?.snapshot !== undefined && usage.snapshot.providerSessionId === timeline.currentProviderThreadId ? usage.snapshot : null;

  const courseSeq = lastChangeSeq(timeline, ["edited", "compacted", "cleared", "forked"]);
  const measuredPoint = lastMeasured(timeline.usage);
  const recomputing = courseSeq !== null && (measuredPoint === undefined || measuredPoint.seq < courseSeq);
  const T = usage !== null && !recomputing ? usage.usedTokens : null;
  const contextWindow =
    usage?.modelContextWindow ??
    [...timeline.usage].reverse().find((point) => point.window !== null)?.window ??
    snapshot?.contextWindowTokens ??
    input.knownWindow ??
    null;

  const sessionItems = input.remote ? [] : (input.session?.items ?? []);
  const allItems = recomputing ? withoutDiscarded(sessionItems, timeline) : sessionItems;
  const items = snapshot !== null ? allItems.filter((item) => !SNAPSHOT_COVERED.has(item.category)) : allItems;
  const estimated = items.flatMap((item, index) => (item.measuredTokens === undefined ? [index] : []));
  const estimateSum = estimated.reduce((sum, index) => sum + (items[index] as SessionItem).estTokens, 0);
  const measuredSum = items.reduce((sum, item) => sum + (item.measuredTokens ?? 0), 0);
  const tokens = items.map((item) => item.measuredTokens ?? item.estTokens);
  const scaleEstimates = (target: number) => {
    const shares = apportion(
      estimated.map((index) => (items[index] as SessionItem).estTokens),
      target,
    );
    estimated.forEach((index, position) => {
      tokens[index] = shares[position] ?? 0;
    });
  };

  const fixed = new Map<CategoryId, Category["entries"]>();
  const fixedTokens = new Map<CategoryId, number>();
  let calibration: number | null = null;
  let unattributed = 0;
  let unattributedLabel = CATEGORY_LABELS.unattributed;
  const kind = input.remote ? "bb-only" : input.source.kind;

  if (snapshot !== null) {
    let nonMessages = 0;
    for (const category of snapshot.categories) {
      const id = snapshotCategory(category);
      if (id === "messages" || id === "free") continue;
      if (category.kind === "used") nonMessages += category.tokens;
      fixedTokens.set(id, (fixedTokens.get(id) ?? 0) + category.tokens);
      const entries = fixed.get(id) ?? [];
      const sourceEntries = category.entries.length > 0 ? category.entries : [{ id: category.id, label: category.label, tokens: category.tokens }];
      for (const entry of sourceEntries) entries.push({ id: entry.id, label: entry.label, detail: null, tokens: entry.tokens, turnIndex: null, children: [] });
      fixed.set(id, entries);
    }
    if (T !== null) {
      const remainder = Math.max(0, T - nonMessages - measuredSum);
      if (estimateSum > 0) {
        scaleEstimates(remainder);
        calibration = remainder / estimateSum;
      } else {
        unattributed = remainder;
      }
    }
  } else if (kind === "pi-session" && T !== null) {
    const remainder = T - measuredSum;
    const factor = estimateSum > 0 ? remainder / estimateSum : 0;
    if (factor >= CALIBRATION_RANGE[0] && factor <= CALIBRATION_RANGE[1]) {
      scaleEstimates(remainder);
      calibration = factor;
    } else {
      unattributed = Math.max(0, remainder - estimateSum);
    }
  } else if (kind === "claude-transcript" && T !== null) {
    const remainder = T - measuredSum;
    const factor = estimateSum > 0 ? remainder / estimateSum : 0;
    if (factor < 1 && factor >= CALIBRATION_RANGE[0]) {
      scaleEstimates(remainder);
      calibration = factor;
    } else {
      unattributed = Math.max(0, remainder - estimateSum);
      if (!items.some((item) => item.category === "system" || item.category === "tools")) unattributedLabel = NOT_IN_TRANSCRIPT_LABEL;
    }
  } else if (kind === "bb-only" && T !== null) {
    unattributed = T;
  } else if (T === null && input.priorCalibration != null && snapshot === null) {
    const factor = input.priorCalibration;
    for (const index of estimated) tokens[index] = Math.round((items[index] as SessionItem).estTokens * factor);
  }

  const calibrated: Calibrated[] = items.map((item, index) => ({ item, tokens: tokens[index] ?? 0 }));
  const matches = matchTurns(timeline.turns, items);
  const turnByOrdinal = new Map<number, number>();
  for (const [turn, ordinal] of matches) turnByOrdinal.set(ordinal, turn + 1);
  const turnOf = (ordinal: number | null) => (ordinal === null ? null : (turnByOrdinal.get(ordinal) ?? null));

  const grouped = new Map<CategoryId, Calibrated[]>();
  for (const entry of calibrated) {
    const list = grouped.get(entry.item.category) ?? [];
    list.push(entry);
    grouped.set(entry.item.category, list);
  }

  const categories: Category[] = [];
  for (const id of CATEGORY_ORDER) {
    if (id === "free") continue;
    const members = grouped.get(id) ?? [];
    let total = members.reduce((sum, member) => sum + member.tokens, 0) + (fixedTokens.get(id) ?? 0);
    let entries = [...(fixed.get(id) ?? []), ...buildEntries(members, id, turnOf)].sort(byTokens).slice(0, MAX_ENTRIES);
    if (id === "unattributed") {
      total += unattributed;
      entries = [];
    }
    if (total <= 0) continue;
    categories.push({ id, label: id === "unattributed" ? unattributedLabel : CATEGORY_LABELS[id], kind: categoryKind(id), tokens: total, entries });
  }

  const usedSum = categories.filter((category) => category.kind === "used").reduce((sum, category) => sum + category.tokens, 0);
  const reserved = categories.find((category) => category.id === "reserved")?.tokens ?? 0;

  const turnFacts = timeline.turns;
  let estimatedTotal = usedSum;
  const lastEdit = timeline.courseChanges.filter((change) => change.kind === "edited").at(-1);
  const baseTokens = categories.filter((category) => BASE_CATEGORIES.includes(category.id)).reduce((sum, category) => sum + category.tokens, 0);

  const cleared = lastChangeSeq(timeline, ["cleared"]);
  const compacted = lastChangeSeq(timeline, ["compacted"]);
  const running = isRunning(input.threadStatus);
  const turns: Turn[] = [];
  let previousAfter: number | null = baseTokens > 0 ? baseTokens : null;
  turnFacts.forEach((fact, index) => {
    const inTurn = timeline.usage.filter((point) => point.seq >= fact.requestSeq && point.seq <= fact.lastSeq);
    const measured = lastMeasured(inTurn);
    const ordinal = matches.get(index);
    let tokensAfter: number | null = measured?.usedTokens ?? null;
    if (tokensAfter === null && ordinal !== undefined) {
      tokensAfter = calibrated
        .filter(({ item }) => item.userOrdinal === null || item.userOrdinal <= ordinal)
        .reduce((sum, entry) => sum + entry.tokens, 0);
    }
    const largest =
      ordinal === undefined
        ? []
        : calibrated
            .filter(({ item }) => item.userOrdinal === ordinal)
            .sort(byTokens)
            .slice(0, MAX_TURN_LARGEST)
            .map((entry) => toEntry(entry, turnOf));
    const state: Turn["state"] =
      cleared !== null && fact.lastSeq < cleared ? "cleared" : compacted !== null && fact.lastSeq < compacted ? "summarized" : "inContext";
    turns.push({
      index: index + 1,
      requestSeq: fact.requestSeq,
      lastSeq: fact.lastSeq,
      at: fact.at,
      preview: oneLine(withoutSenderHeader(fact.text), MAX_PREVIEW),
      text: fact.text.slice(0, MAX_TEXT),
      textTruncated: fact.text.length > MAX_TEXT,
      state,
      tokensBefore: previousAfter,
      tokensAfter,
      measured: measured !== undefined,
      largest,
      editable: !running && fact.userSent,
      notEditableReason: !fact.userSent ? "Sent by another thread or an agent" : running ? "The thread is running" : null,
      running: running && index === turnFacts.length - 1,
    });
    previousAfter = tokensAfter ?? previousAfter;
  });

  if (T === null && recomputing && lastEdit !== undefined) {
    const edited = turns.find((turn) => turn.index === lastEdit.beforeTurnIndex);
    if (edited !== undefined && edited.tokensBefore !== null) {
      estimatedTotal = Math.max(estimatedTotal, edited.tokensBefore + estimateTokens(edited.text));
    }
  }

  const usedTokens = T ?? (estimatedTotal > 0 ? estimatedTotal : null);
  const basis: ContextReport["window"]["basis"] = T !== null ? "measured" : usedTokens !== null ? "estimated" : "none";
  if (contextWindow !== null && usedTokens !== null) {
    const free = Math.max(0, contextWindow - Math.max(usedSum, usedTokens) - reserved);
    if (free > 0) categories.push({ id: "free", label: CATEGORY_LABELS.free, kind: "free", tokens: free, entries: [] });
    categories.sort((a, b) => CATEGORY_ORDER.indexOf(a.id) - CATEGORY_ORDER.indexOf(b.id));
  }

  const segments: Segment[] = categories
    .filter((category) => (category.kind === "used" || category.kind === "reserved") && category.tokens > 0)
    .map(({ id, label, tokens: value }) => ({ id, label, tokens: value }));
  const top = segments
    .filter((segment) => categoryKind(segment.id) === "used")
    .sort(byTokens)
    .slice(0, 3);

  const largest = calibrated
    .filter((entry) => entry.tokens > 0 && !BASE_CATEGORIES.includes(entry.item.category) && entry.item.category !== "other")
    .map((entry) => ({ ...toEntry(entry, turnOf), categoryId: entry.item.category }))
    .filter((entry) => entry.turnIndex !== null)
    .sort(byTokens)
    .slice(0, MAX_LARGEST);

  return {
    threadId: input.threadId,
    providerId: input.providerId,
    threadStatus: input.threadStatus,
    window: {
      usedTokens,
      contextWindow,
      autoCompactAt: snapshot?.autoCompactAtTokens ?? null,
      model: snapshot?.model ?? input.session?.model ?? null,
      measuredAt: basis === "measured" ? (measuredPoint?.at ?? null) : null,
      basis,
      recomputing,
    },
    segments: basis === "none" ? [] : segments,
    top: basis === "none" ? [] : top,
    categories: basis === "none" ? [] : categories,
    largest,
    turns,
    courseChanges: withRewindPoints(withSessionCompactions(timeline.courseChanges, input.session?.compactions ?? []), turns),
    source: {
      kind: snapshot !== null ? "claude-snapshot" : kind,
      path: input.remote ? null : input.source.path,
      calibration,
    },
    notes: caveats(input, timeline, snapshot === null && isClaude),
  };
}

function caveats(input: ComposeInput, timeline: Timeline, claudeWithoutSnapshot: boolean): string[] {
  const notes: string[] = [];
  if (input.remote) notes.push("Remote host: breakdown unavailable");
  else if (input.source.kind === "bb-only" && input.usage !== null) notes.push("Breakdown unavailable for this provider");
  if (claudeWithoutSnapshot && !input.remote) notes.push("No /context snapshot for this session");
  if (timeline.courseChanges.some((change) => change.kind === "edited" && change.discardedTurns === null)) {
    notes.push("Turns before the plugin was installed can't be counted after an edit");
  }
  const fallbackSteps = input.remote ? 0 : (input.session?.fallbackSteps ?? 0);
  if (fallbackSteps > 0) notes.push(`${fallbackSteps} step${fallbackSteps === 1 ? "" : "s"} fell back to estimates`);
  return notes.slice(0, MAX_NOTES);
}

/** Fills compaction sizes bb did not measure from the provider's own record, matched from the end. */
function withSessionCompactions(changes: readonly CourseChange[], compactions: readonly SessionCompaction[]): CourseChange[] {
  const result = [...changes];
  let cursor = compactions.length - 1;
  for (let index = result.length - 1; index >= 0 && cursor >= 0; index--) {
    const change = result[index] as CourseChange;
    if (change.kind !== "compacted") continue;
    const recorded = compactions[cursor--] as SessionCompaction;
    result[index] = { ...change, tokensBefore: change.tokensBefore ?? recorded.tokensBefore, tokensAfter: change.tokensAfter ?? recorded.tokensAfter };
  }
  return result;
}

/** An edit's `tokensAfter` is where it rewound to, the same figure the editor promised as "frees". */
function withRewindPoints(changes: readonly CourseChange[], turns: readonly Turn[]): CourseChange[] {
  return changes.map((change) => {
    if (change.kind !== "edited") return change;
    const rewoundTo = turns.find((turn) => turn.index === change.beforeTurnIndex)?.tokensBefore ?? null;
    return rewoundTo === null ? change : { ...change, tokensAfter: rewoundTo };
  });
}

export function toMeter(report: ContextReport): Meter {
  return {
    threadId: report.threadId,
    providerId: report.providerId,
    threadStatus: report.threadStatus,
    window: report.window,
    segments: report.segments,
    top: report.top,
  };
}
