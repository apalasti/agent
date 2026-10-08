import { Icon } from "@/components/ui/icon";

export function ViewHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1 px-2 py-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover"
      >
        <Icon name="ChevronLeft" aria-hidden className="size-4" />
      </button>
      <h2 className="min-w-0 truncate text-sm font-medium">{title}</h2>
    </div>
  );
}
