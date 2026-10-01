import { useState, useRef, useEffect } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { FaChevronRight, FaFolderOpen, FaLayerGroup, FaPlus, FaTrash } from 'react-icons/fa6';
import { GROUP_DROP_PREFIX } from '../utils/constants';

export function FeaturesSectionHeader({ onAddGroup }: { onAddGroup: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: GROUP_DROP_PREFIX });

  return (
    <div ref={setNodeRef}
      className={`flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-2 transition-colors dark:border-slate-700 ${
        isOver ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'bg-slate-50 dark:bg-slate-800'
      }`}>
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Features</span>
      <button type="button" onClick={onAddGroup}
        className="sticky right-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
        title="Add a group of features (saved as a tag)">
        <FaPlus className="size-2.5" /> Add group
      </button>
    </div>
  );
}

export function FeatureGroupHeader({
  tag, count, collapsed, existingGroups, autoEdit, onToggle, onRename, onRemove, onEditDone,
}: {
  tag: string; count: number; collapsed: boolean; existingGroups: string[]; autoEdit?: boolean;
  onToggle: () => void; onRename: (newTag: string) => void; onRemove: () => void; onEditDone?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: GROUP_DROP_PREFIX + tag });
  const [editing, setEditing] = useState(!!autoEdit);
  const [name, setName] = useState(tag);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  useEffect(() => { setName(tag); }, [tag]);

  const trimmed = name.trim();
  const isDuplicate = trimmed !== tag && existingGroups.includes(trimmed);

  const finish = (commit: boolean) => {
    setEditing(false);
    if (commit && trimmed && trimmed !== tag && !isDuplicate) onRename(trimmed);
    else setName(tag);
    onEditDone?.();
  };

  return (
    <div ref={setNodeRef}
      className={`group/header flex shrink-0 items-center gap-2 border-b border-t border-slate-200 px-4 py-2 transition-colors dark:border-slate-700 ${
        isOver ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'bg-indigo-50/40 dark:bg-slate-800/70'
      }`}>
      <button type="button" onClick={onToggle}
        className="flex size-6 cursor-pointer items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-600 dark:hover:bg-slate-700"
        aria-expanded={!collapsed} aria-label={collapsed ? `Expand ${tag}` : `Collapse ${tag}`}>
        <FaChevronRight className={`size-2.5 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
      </button>
      {collapsed ? <FaLayerGroup className="size-3 shrink-0 text-indigo-400" /> : <FaFolderOpen className="size-3 shrink-0 text-indigo-400" />}
      {editing ? (
        <input ref={inputRef} value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); }}
          aria-invalid={isDuplicate}
          title={isDuplicate ? 'A group with this name already exists' : undefined}
          className={`min-w-[120px] rounded border bg-white px-1.5 py-0.5 text-sm font-semibold text-slate-900 outline-none ring-2 dark:bg-slate-800 dark:text-white ${
            isDuplicate ? 'border-red-400 ring-red-500/20' : 'border-indigo-300 ring-indigo-500/20 dark:border-indigo-600'
          }`}
        />
      ) : (
        <span role="button" tabIndex={0} title="Rename group"
          onClick={() => setEditing(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') setEditing(true); }}
          className="cursor-pointer truncate rounded px-1 py-0.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">
          {tag}
        </span>
      )}
      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">{count}</span>
      {count === 0 && !editing && (
        <span className="hidden text-[11px] italic text-slate-400 sm:inline dark:text-slate-500">Drag features here</span>
      )}
      <button type="button" onClick={onRemove}
        className="sticky right-4 ml-auto flex size-7 cursor-pointer items-center justify-center rounded-md text-slate-400 opacity-100 transition-colors hover:bg-red-50 hover:text-red-500 md:opacity-0 md:group-hover/header:opacity-100 md:focus-visible:opacity-100 dark:hover:bg-red-950/50"
        aria-label={`Remove group ${tag}`} title="Remove group (features are kept, ungrouped)">
        <FaTrash className="size-3" />
      </button>
    </div>
  );
}
