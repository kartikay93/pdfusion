import React from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RotateCw, Trash2, GripVertical } from 'lucide-react';

function PageCard({ page, position, onRotate, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.pageIndex
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-ink/10 bg-white shadow-soft [.theme-blossom_&]:border-blossom-200"
    >
      <div className="flex items-center justify-between border-b border-ink/5 px-2 py-1.5">
        <span className="flex items-center gap-1 text-xs font-medium text-ink/50">
          <button {...attributes} {...listeners} className="cursor-grab touch-none rounded p-0.5 hover:bg-ink/5" aria-label="Drag to reorder">
            <GripVertical size={13} />
          </button>
          Page {position + 1}
        </span>
        <span className="flex items-center gap-1">
          <button
            onClick={() => onRotate(page.pageIndex)}
            title="Rotate 90°"
            className="rounded p-1 text-ink/40 hover:bg-ink/5 hover:text-ink"
          >
            <RotateCw size={13} />
          </button>
          <button
            onClick={() => onDelete(page.pageIndex)}
            title="Remove page"
            className="rounded p-1 text-ink/40 hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>
      <div className="flex items-center justify-center bg-ink/[0.02] p-2">
        <img
          src={page.dataUrl}
          alt={`Page ${position + 1}`}
          draggable={false}
          style={{ transform: `rotate(${page.rotation || 0}deg)` }}
          className="max-h-48 w-auto select-none rounded shadow-sm transition-transform"
        />
      </div>
    </div>
  );
}

export default function PageGrid({ pages, order, onOrderChange, onRotate, onDelete }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const pageByIndex = Object.fromEntries(pages.map((p) => [p.pageIndex, p]));

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = order.indexOf(active.id);
    const newIdx = order.indexOf(over.id);
    onOrderChange(arrayMove(order, oldIdx, newIdx));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {order.map((pageIndex, position) => (
            <PageCard
              key={pageIndex}
              page={pageByIndex[pageIndex]}
              position={position}
              onRotate={onRotate}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
