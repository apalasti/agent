import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Modifiers } from "./useLaunch";

export function ChartFooter({ busy, onChart }: { busy: string | null; onChart: (idea: string, event: Modifiers) => void }) {
  const [idea, setIdea] = useState("");
  const submit = (event: Modifiers) => {
    const trimmed = idea.trim();
    if (trimmed !== "") onChart(trimmed, event);
  };
  return (
    <section className="grid gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">Chart a new map</h3>
      <div className="flex items-center gap-2">
        <Input
          value={idea}
          onChange={(event) => setIdea(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit(event);
          }}
          placeholder="The idea, in a line or two"
          className="h-8"
          aria-label="Idea for a new map"
        />
        <Button size="sm" variant="outline" disabled={busy !== null || idea.trim() === ""} onClick={submit}>
          {busy === "chart" ? "Starting…" : "Chart"}
        </Button>
      </div>
    </section>
  );
}
