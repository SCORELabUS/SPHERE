import { useState, useRef, useEffect } from 'react';

export function CellInlineEdit({
  value, onSave, className, numeric,
}: {
  value: string; onSave: (v: string) => void; className?: string; numeric?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <span role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setEditing(true); } }}
        className={`cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 ${className ?? ''}`}
      >{value || <span className="italic text-slate-300 dark:text-slate-600">—</span>}</span>
    );
  }

  return (
    <input ref={inputRef} type={numeric ? 'number' : 'text'} value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft !== value) onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); if (draft !== value) onSave(draft); }
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      className="rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-center text-sm font-semibold text-slate-900 outline-none ring-2 ring-indigo-500/20 min-w-[50px] max-w-[120px] dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
    />
  );
}
