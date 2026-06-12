import { useState, useRef, useEffect } from 'react';
import { camelToTitle } from '../../pricing-renderer/shared/stringUtils';
import { toCamelCase } from '../utils/names';

export function NameInlineEdit({
  value, onSave, className, light,
}: {
  value: string; onSave: (newKey: string) => void; className?: string; light?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(camelToTitle(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  useEffect(() => { setDraft(camelToTitle(value)); }, [value]);

  if (!editing) {
    return (
      <span role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setEditing(true); } }}
        className={`cursor-pointer truncate rounded px-1 py-0.5 transition-colors ${light ? 'hover:bg-white/20' : 'hover:bg-slate-100 dark:hover:bg-slate-700'} ${className ?? ''}`}
      >{camelToTitle(value)}</span>
    );
  }

  return (
    <input ref={inputRef} type="text" value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^a-zA-Z0-9\s]/g, ''))}
      onBlur={() => { setEditing(false); const k = toCamelCase(draft); if (k && k !== value) onSave(k); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); const k = toCamelCase(draft); if (k && k !== value) onSave(k); }
        if (e.key === 'Escape') { setDraft(camelToTitle(value)); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      className={`w-full rounded border px-1.5 py-0.5 text-sm font-semibold text-center outline-none ring-2 ${
        light
          ? 'border-white/30 bg-white/20 text-white ring-white/20'
          : 'border-indigo-300 bg-white text-slate-900 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white'
      }`}
    />
  );
}
