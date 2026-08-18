import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { GripVertical } from "lucide-react";

interface DragReorderListProps<T extends { id: string }> {
  items: T[];
  onReorder: (ids: string[]) => void;
  renderRow: (item: T, handle: ReactNode) => ReactNode;
  /** Spoken name for a row, so the keyboard path can announce what moved. */
  labelFor?: (item: T) => string;
}

function move(ids: string[], from: number, to: number): string[] | null {
  if (from < 0 || to < 0 || to >= ids.length || from === to) return null;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (!moved) return null;
  next.splice(to, 0, moved);
  return next;
}

/**
 * HTML5 drag-and-drop reorder, with a keyboard equivalent.
 *
 * Two things were wrong. `dragId` was cleared only in `onDrop`, so dropping
 * outside any row left that row stuck at 60% opacity until the tree remounted —
 * it looked like a pending save that never resolved. And the handle was a bare
 * `<span draggable>`: not focusable, no key handling, so ordering the library
 * was impossible without a mouse.
 */
export function DragReorderList<T extends { id: string }>({
  items,
  onReorder,
  renderRow,
  labelFor,
}: DragReorderListProps<T>) {
  const [dragId, setDragId] = useState<string | null>(null);

  function onDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function onDrop(targetId: string) {
    const ids = items.map((i) => i.id);
    const next = dragId ? move(ids, ids.indexOf(dragId), ids.indexOf(targetId)) : null;
    setDragId(null);
    if (next) onReorder(next);
  }

  function nudge(e: KeyboardEvent, id: string) {
    const delta = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(id);
    const next = move(ids, from, from + delta);
    if (next) onReorder(next);
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const name = labelFor?.(item) ?? "this entry";
        const handle = (
          <span
            draggable
            role="button"
            tabIndex={0}
            aria-label={`Reorder ${name} — drag, or use the up and down arrow keys`}
            onDragStart={() => setDragId(item.id)}
            // Fires however the drag ended, including a drop on nothing. Without
            // it the row stayed half-faded forever.
            onDragEnd={() => setDragId(null)}
            onKeyDown={(e) => nudge(e, item.id)}
            className="inline-flex cursor-grab rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </span>
        );
        return (
          <li
            key={item.id}
            onDragOver={onDragOver}
            onDrop={() => onDrop(item.id)}
            className={dragId === item.id ? "opacity-60" : undefined}
          >
            {renderRow(item, handle)}
          </li>
        );
      })}
    </ul>
  );
}
