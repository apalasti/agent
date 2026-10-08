import { experimental_useSidebarThreads as useSidebarThreads, ThreadTitle, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import type { CourseChange } from "../contract";
import { formatTokens, plural } from "./format";
import { CLEAR_ICON, COMPACT_ICON, FORK_ICON } from "./icon";

const ICON: Record<CourseChange["kind"], string> = {
  edited: "Edit",
  compacted: COMPACT_ICON,
  compactionSkipped: COMPACT_ICON,
  cleared: CLEAR_ICON,
  forked: FORK_ICON,
};

function SourceThreadLink({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  const known = useSidebarThreads().threads.some((thread) => thread.id === threadId);
  return (
    <button
      type="button"
      onClick={() => navigate.toThread(threadId)}
      className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline"
    >
      {known ? <ThreadTitle threadId={threadId} /> : threadId}
    </button>
  );
}

export function courseChangeText(change: CourseChange): string {
  switch (change.kind) {
    case "edited": {
      const discarded = change.discardedTurns === null ? "earlier turns" : plural(change.discardedTurns, "turn");
      const freed =
        change.tokensBefore !== null && change.tokensAfter !== null && change.tokensBefore > change.tokensAfter
          ? ` (${formatTokens(change.tokensBefore - change.tokensAfter)} tokens)`
          : "";
      return `Edited: ${discarded} discarded${freed}`;
    }
    case "compacted":
      return change.tokensBefore !== null && change.tokensAfter !== null
        ? `Compacted ${formatTokens(change.tokensBefore)} → ${formatTokens(change.tokensAfter)}`
        : "Compacted";
    case "compactionSkipped":
      return "Compaction skipped (session too small)";
    case "cleared":
      return "Context cleared";
    case "forked":
      return "Forked from";
  }
}

export function CourseChangeText({ change }: { change: CourseChange }): ReactNode {
  if (change.kind === "forked" && change.sourceThreadId !== null) {
    return (
      <>
        Forked from <SourceThreadLink threadId={change.sourceThreadId} />
      </>
    );
  }
  if (change.kind === "forked") return "Forked from another thread";
  return courseChangeText(change);
}

export function CourseChangeIcon({ kind, className }: { kind: CourseChange["kind"]; className?: string }) {
  return <Icon name={ICON[kind]} className={className} aria-hidden />;
}

export function CourseChangeRow({ change }: { change: CourseChange }) {
  return (
    <li
      data-course-change={change.kind}
      className="flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground"
    >
      <span className="h-px w-3 shrink-0 bg-border" />
      <CourseChangeIcon kind={change.kind} className="size-3.5 shrink-0" />
      <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
        <CourseChangeText change={change} />
      </span>
      <span className="h-px min-w-3 flex-1 bg-border" />
    </li>
  );
}
