import type { Step } from "../contract";

type Group = "command" | "read" | "edit" | "search" | "other";

const GROUP_OF: Record<string, Group> = {
  bash: "command",
  read: "read",
  edit: "edit",
  write: "edit",
  grep: "search",
  find: "search",
  ls: "search",
};

const GROUP_ORDER: Group[] = ["command", "read", "edit", "search", "other"];

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

function phrase(group: Group, steps: Step[]): string {
  const files = new Set(steps.map((step) => step.summary));
  const onlyFile = basename([...files][0] ?? "");
  switch (group) {
    case "command":
      return `ran ${plural(steps.length, "1 command", "commands")}`;
    case "read":
      return `read ${plural(files.size, onlyFile, "files")}`;
    case "edit":
      return `edited ${plural(files.size, onlyFile, "files")}`;
    case "search":
      return `searched ${plural(steps.length, "once", "times")}`;
    case "other":
      return `used ${plural(steps.length, "a tool", "tools")}`;
  }
}

export function activitySummary(steps: Step[]): string {
  const groups = new Map<Group, Step[]>();
  for (const step of steps) {
    if (step.kind !== "tool") continue;
    const group = GROUP_OF[step.name] ?? "other";
    groups.set(group, [...(groups.get(group) ?? []), step]);
  }
  const text = GROUP_ORDER.flatMap((group) => {
    const members = groups.get(group);
    if (!members) return [];
    const failed = members.filter((step) => step.isError).length;
    return [failed > 0 ? `${phrase(group, members)} (${failed} failed)` : phrase(group, members)];
  }).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
