import { useState, type DragEvent, type ReactNode } from "react";
import { GripVertical } from "lucide-react";

interface DragReorderListProps<T extends { id: string }> {
  items: T[];
  onReorder: (ids: string[]) => void;
  renderRow: (item: T, handle: ReactNode) => ReactNode;
}

/** HTML5 drag-and-drop reorder (no extra DnD package). */
export function DragReorderList<T extends { id: string }>({
  items,
  onReorder,
  renderRow,
}: DragReorderListProps<T>) {
  const [dragId, setDragId] = useState<string | null>(null);

  function onDragStart(id: string) {
    setDragId(id);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      return;
    }
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    if (!moved) {
      setDragId(null);
      return;
    }
    next.splice(to, 0, moved);
    setDragId(null);
    onReorder(next);
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const handle = (
          <span
            draggable
            onDragStart={() => onDragStart(item.id)}
            className="inline-flex cursor-grab text-muted-foreground active:cursor-grabbing"
            aria-label="Drag to reorder"
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
