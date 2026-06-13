import { useState, useRef, useEffect } from 'react';
import { toCamelCase } from '../utils/names';

export function CreatingNameInput({ initialKey, onConfirm, onCancel }: {
  initialKey: string; onConfirm: (newKey: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initialKey);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input ref={inputRef} value={name}
      onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9\s]/g, ''))}
      onBlur={() => { const k = toCamelCase(name); if (k && k !== initialKey) onConfirm(k); else onCancel(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { const k = toCamelCase(name); if (k) onConfirm(k); else onCancel(); }
        if (e.key === 'Escape') onCancel();
      }}
      className="w-full rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-slate-900 outline-none ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
    />
  );
}
