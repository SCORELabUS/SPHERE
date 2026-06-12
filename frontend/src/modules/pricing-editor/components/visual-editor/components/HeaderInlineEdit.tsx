import { useState, useRef, useEffect } from 'react';

export function HeaderInlineEdit({
  value, onSave, className, selectOnFocus, numeric,
}: {
  value: string; onSave: (v: string) => void; className?: string; selectOnFocus?: boolean; numeric?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); if (selectOnFocus) inputRef.current.select(); } }, [editing, selectOnFocus]);
  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <span role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setEditing(true); } }}
        className={`cursor-pointer truncate rounded px-1 transition-colors hover:bg-white/20 ${className ?? ''}`}
      >{value || <span className="italic text-white/30">empty</span>}</span>
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
      className="rounded bg-white/20 px-2 py-1 text-center text-sm font-semibold text-white outline-none ring-1 ring-white/30 min-w-[60px]"
    />
  );
}
