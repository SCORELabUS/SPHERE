import { useState, useRef, useEffect } from 'react';
import { FaTimesCircle } from 'react-icons/fa';
import { UsageLimit } from 'pricing4ts';
import { formatUsageDisplay } from '../../pricing-renderer/shared/value-helpers';

export function UsageValueCell({
  value, usage, onSave,
}: {
  value: string | number | boolean; usage: UsageLimit; onSave: (v: string | number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ''));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  useEffect(() => { setDraft(String(value ?? '')); }, [value]);

  const isZero = !value || value === 0 || value === '' || (typeof value === 'string' && value.trim() === '');

  if (!editing) {
    if (isZero) {
      return (
        <span role="button" tabIndex={0}
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setEditing(true); } }}
          className="cursor-pointer"
        >
          <FaTimesCircle className="text-slate-300 dark:text-slate-600" />
        </span>
      );
    }
    return (
      <span role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setEditing(true); } }}
        className="cursor-pointer inline-flex items-center justify-center rounded-full bg-indigo-500 px-4 py-1.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
      >
        {formatUsageDisplay(value, usage)}
      </span>
    );
  }

  return (
    <input ref={inputRef} type="number" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); const p = Number(draft); if (!Number.isNaN(p)) onSave(p); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); const p = Number(draft); if (!Number.isNaN(p)) onSave(p); }
        if (e.key === 'Escape') { setDraft(String(value ?? '')); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      className="rounded border border-indigo-300 bg-white px-2 py-0.5 text-center text-sm font-semibold text-slate-900 outline-none ring-2 ring-indigo-500/20 min-w-[50px] max-w-[120px] dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
    />
  );
}
