import { useState, useRef, useEffect, useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'framer-motion';
import { FaTrash, FaGripVertical, FaLink, FaArrowRightArrowLeft, FaLock, FaPlus, FaXmark, FaSliders } from 'react-icons/fa6';
import { FaCheckCircle, FaTimesCircle } from 'react-icons/fa';
import { NameInlineEdit } from './NameInlineEdit';
import PALETTE from '../../pricing-renderer/shared/planPalette';
import { camelToTitle } from '../../pricing-renderer/shared/stringUtils';
import { formatMoneyDisplay } from '../../pricing-renderer/shared/value-helpers';
import type { DraftAddOn } from '../../../services/pricing2yaml';
import type { DraggableAttributes } from '@dnd-kit/core';

/* ── Searchable combobox select ── */
function ComboboxSelect({ options, onSelect, placeholder }: {
  options: string[]; onSelect: (key: string) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hoveredIdx, setHoveredIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => { setHoveredIdx(0); }, [query]);

  const select = (key: string) => { onSelect(key); setOpen(false); setQuery(''); };

  if (!open) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[10px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-indigo-500 dark:hover:bg-slate-700 dark:hover:text-indigo-400">
        <FaPlus className="h-2 w-2" /> add
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <input ref={inputRef} value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && filtered.length > 0) { select(filtered[hoveredIdx] ?? filtered[0]); }
          if (e.key === 'Escape') { setOpen(false); setQuery(''); }
          if (e.key === 'ArrowDown') { e.preventDefault(); setHoveredIdx(i => Math.min(i + 1, filtered.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHoveredIdx(i => Math.max(i - 1, 0)); }
        }}
        placeholder={placeholder ?? 'Search...'}
        className="w-36 rounded border border-indigo-300 bg-white px-2 py-0.5 text-[10px] text-slate-900 outline-none ring-1 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
      />
      {filtered.length > 0 && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-40 w-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {filtered.map((ok, i) => (
            <button key={ok} type="button" onClick={() => select(ok)}
              onMouseEnter={() => setHoveredIdx(i)}
              className={`flex w-full cursor-pointer items-center px-2.5 py-1.5 text-left text-[11px] transition-colors dark:text-slate-300 ${
                i === hoveredIdx
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-slate-800 dark:text-white'
                  : 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-slate-800 dark:hover:text-white'
              }`}>
              {camelToTitle(ok)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Section header ── */
function SectionHeader({ label, count, editable, options, onAdd, placeholder }: {
  label: string; count: number; editable: boolean;
  options?: string[]; onAdd?: (key: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
      <span>{label}</span>
      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-400">{count}</span>
      {editable && options && options.length > 0 && onAdd && <ComboboxSelect options={options} onSelect={onAdd} placeholder={placeholder} />}
    </div>
  );
}

/* ── Inline description ── */
function InlineDescription({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing && textareaRef.current) { textareaRef.current.focus(); textareaRef.current.select(); } }, [editing]);
  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <p role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setEditing(true); } }}
        className="mt-2 cursor-pointer rounded px-1 py-0.5 text-xs text-slate-500 transition-colors hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
      >{value || <span className="italic text-slate-300 dark:text-slate-600">Add description...</span>}</p>
    );
  }
  return (
    <textarea ref={textareaRef} value={draft} rows={2}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft !== value) onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { setEditing(false); if (draft !== value) onSave(draft); }
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      className="mt-2 w-full resize-none rounded border border-indigo-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
    />
  );
}

/* ── Inline price ── */
function InlinePrice({ price, currency, onSave }: { price: number | string; currency: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(price));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  useEffect(() => { setDraft(String(price)); }, [price]);

  const display = typeof price === 'number' ? `${currency}${price}` : price || '0';

  if (!editing) {
    return (
      <span role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setEditing(true); } }}
        className="cursor-pointer inline-flex items-center rounded-full bg-tp-primary px-2.5 py-1 text-sm font-bold text-white transition-opacity hover:opacity-90"
      >{display}</span>
    );
  }
  return (
    <input ref={inputRef} type="text" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft !== price) onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); if (draft !== price) onSave(draft); }
        if (e.key === 'Escape') { setDraft(String(price)); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-24 rounded-full border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-center text-sm font-bold text-indigo-900 outline-none ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-indigo-950 dark:text-indigo-100"
    />
  );
}

/* ── Inline unit ── */
function InlineUnit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
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
        className="cursor-pointer rounded px-1 py-0.5 text-xs text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800"
      >/{value || <span className="italic text-slate-300 dark:text-slate-600">unit</span>}</span>
    );
  }
  return (
    <span className="inline-flex items-center text-xs text-slate-400">/<input ref={inputRef} type="text" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft !== value) onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); if (draft !== value) onSave(draft); }
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-16 rounded border border-indigo-300 bg-white px-1 py-0.5 text-xs font-semibold text-slate-900 outline-none ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
    /></span>
  );
}

/* ── Value row with type-aware inline editing ── */
function InlineValueRow({ label, value, valueType, editable, onValueChange, onRemove }: {
  label: string; value: string | number | boolean;
  valueType: 'BOOLEAN' | 'TEXT' | 'NUMERIC';
  editable: boolean;
  onValueChange?: (v: string | number | boolean) => void;
  onRemove?: () => void;
}) {
  return (
    <div className={`flex items-center gap-1 text-xs ${editable ? 'group/row' : ''}`}>
      <span className="w-28 truncate text-slate-500 dark:text-slate-400" title={label}>{camelToTitle(label)}</span>
      <span className="text-slate-300 dark:text-slate-600">·</span>
      {valueType === 'BOOLEAN' ? (
        editable ? (
          <BooleanToggle value={!!value} onChange={onValueChange!} />
        ) : (
          value ? <FaCheckCircle className="text-base text-tp-primary" /> : <FaTimesCircle className="text-base text-slate-300 dark:text-slate-600" />
        )
      ) : valueType === 'NUMERIC' ? (
        editable ? (
          <NumericInlineEdit value={value} onSave={(v) => onValueChange!(Number.isNaN(Number(v)) ? 0 : Number(v))} />
        ) : (
          <span className="rounded bg-indigo-50 px-2 py-0.5 font-mono text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            {String(value) || '0'}
          </span>
        )
      ) : (
        editable ? (
          <TextInlineEdit value={String(value)} onSave={onValueChange!} />
        ) : (
          <span className="rounded px-1 py-0.5 font-mono text-xs text-slate-700 dark:text-slate-300">
            {String(value) || '—'}
          </span>
        )
      )}
      {editable && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          className="shrink-0 cursor-pointer rounded p-0.5 text-slate-300 opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400">
          <FaXmark className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

/* ── Boolean toggle ── */
function BooleanToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <motion.div className="flex cursor-pointer items-center justify-center"
      onClick={() => onChange(!value)}
      whileTap={{ scale: 0.8 }} transition={{ type: 'spring', stiffness: 800, damping: 35 }}
    >
      <AnimatePresence mode="wait">
        {value ? (
          <motion.div key="on" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
            transition={{ type: 'spring', stiffness: 800, damping: 35 }}>
            <FaCheckCircle className="text-base text-tp-primary" />
          </motion.div>
        ) : (
          <motion.div key="off" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
            transition={{ type: 'spring', stiffness: 800, damping: 35 }}>
            <FaTimesCircle className="text-base text-slate-300 dark:text-slate-600" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Numeric inline edit ── */
function NumericInlineEdit({ value, onSave }: { value: string | number | boolean; onSave: (v: string) => void }) {
  const str = String(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(str);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  useEffect(() => { setDraft(str); }, [str]);

  if (!editing) {
    return (
      <span role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setEditing(true); } }}
        className="cursor-pointer rounded bg-indigo-50 px-2 py-0.5 font-mono text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
      >{str || <span className="italic text-slate-300 dark:text-slate-600">0</span>}</span>
    );
  }
  return (
    <input ref={inputRef} type="number" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); onSave(draft); }
        if (e.key === 'Escape') { setDraft(str); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-20 rounded border border-indigo-300 bg-white px-1.5 py-0.5 font-mono text-xs text-slate-900 outline-none ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
    />
  );
}

/* ── Text inline edit (auto-sizing) ── */
function TextInlineEdit({ value, onSave }: { value: string; onSave: (v: string | boolean | number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  useEffect(() => { setDraft(value); }, [value]);

  const inputWidth = useMemo(() => {
    if (!editing) return 'auto';
    const len = draft.length || 1;
    return `${Math.max(len, 3) + 1.5}ch`;
  }, [editing, draft]);

  if (!editing) {
    return (
      <span role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setEditing(true); } }}
        className="cursor-pointer rounded px-1 py-0.5 font-mono text-xs text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
      >{value || <span className="italic text-slate-300 dark:text-slate-600">—</span>}</span>
    );
  }
  return (
    <input ref={inputRef} type="text" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft !== value) onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); if (draft !== value) onSave(draft); }
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      style={{ width: inputWidth }}
      className="rounded border border-indigo-300 bg-white px-1 py-0.5 font-mono text-xs text-slate-900 outline-none ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
    />
  );
}

/* ── Shared type for add-on data ── */
export interface AddOnCardProps {
  addOnKey: string;
  addOn: DraftAddOn;
  planKeys: string[];
  planIndexMap: Record<string, number>;
  currency: string;
  editable?: boolean;
  featureMap?: Record<string, { valueType?: string; defaultValue?: unknown }>;
  usageLimitMap?: Record<string, { valueType?: string; defaultValue?: unknown }>;
  isDragging?: boolean;
  isOverlay?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onRename?: (oldKey: string, newKey: string) => void;
  onToggleAvailableFor?: (planKey: string) => void;
  onUpdate?: (updates: Partial<DraftAddOn>) => void;
  containerRef?: React.Ref<HTMLElement>;
  containerStyle?: React.CSSProperties;
  dragListeners?: Record<string, unknown>;
  dragAttributes?: DraggableAttributes;
}

/* ── Card content (no DnD hooks) ── */
function AddOnCardContent(
  {
    addOnKey, addOn, planKeys, planIndexMap, currency,
    editable = false,
    featureMap = {}, usageLimitMap = {},
    onEdit, onRemove, onRename, onToggleAvailableFor, onUpdate,
    containerRef, containerStyle, dragListeners, dragAttributes,
  }: AddOnCardProps,
) {
  const isAvailableFor = (pk: string) => !addOn.availableFor || addOn.availableFor.includes(pk);

  const featureEntries = Object.entries(addOn.features ?? {});
  const usageEntries = Object.entries(addOn.usageLimits ?? {});
  const extensionEntries = Object.entries(addOn.usageLimitsExtensions ?? {});

  const availableFeatures = Object.keys(featureMap).filter(k => !(addOn.features ?? {})[k]);
  const availableUsageLimits = Object.keys(usageLimitMap).filter(k => !(addOn.usageLimits ?? {})[k]);
  const availableExtensions = Object.keys(usageLimitMap).filter(k => !(addOn.usageLimitsExtensions ?? {})[k]);

  const hasAnyContent = featureEntries.length > 0 || usageEntries.length > 0 || extensionEntries.length > 0
    || (addOn.dependsOn && addOn.dependsOn.length > 0)
    || (addOn.excludes && addOn.excludes.length > 0);

  return (
    <div
      ref={containerRef as React.Ref<HTMLDivElement>}
      style={containerStyle}
      {...(dragAttributes as unknown as React.HTMLAttributes<HTMLDivElement>)}
      className={`group relative flex flex-col rounded-xl border bg-white shadow-sm transition-all dark:bg-slate-900 ${
        !editable ? 'border-slate-200 hover:shadow-md dark:border-slate-700'
          : 'border-slate-200 hover:shadow-md dark:border-slate-700'
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-2 border-b border-slate-100 px-4 pt-4 pb-3 dark:border-slate-800">
        {editable && (
          <div {...(dragListeners as unknown as React.HTMLAttributes<HTMLDivElement>)} className="mt-1 shrink-0 cursor-grab text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-500 active:cursor-grabbing">
            <FaGripVertical className="h-3 w-3" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {editable ? (
            <NameInlineEdit value={addOnKey} onSave={(nk) => onRename?.(addOnKey, nk)}
              className="text-sm font-bold text-slate-800 dark:text-slate-200" />
          ) : (
            <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
              {camelToTitle(addOnKey)}
            </div>
          )}
        </div>
        {editable && (
          <>
            <button type="button" onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
              className="shrink-0 cursor-pointer rounded p-1 text-slate-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-slate-100 hover:text-indigo-500 dark:hover:bg-slate-800" title="Advanced settings">
              <FaSliders className="h-3 w-3" />
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
              className="shrink-0 cursor-pointer rounded p-1 text-slate-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950" title="Remove add-on">
              <FaTrash className="h-3 w-3" />
            </button>
          </>
        )}
      </div>

      {/* Price + Description */}
      <div className="px-4 py-3">
        <div className="flex items-baseline gap-1.5">
          {editable ? (
            <>
              <InlinePrice price={addOn.price} currency={currency}
                onSave={(v) => { const p = v === '' ? 0 : Number(v); onUpdate?.({ price: Number.isNaN(p) ? 0 : p }); }} />
              <InlineUnit value={addOn.unit ?? ''}
                onSave={(v) => onUpdate?.({ unit: v || undefined })} />
            </>
          ) : (
            <>
              <span className="inline-flex items-center rounded-full bg-tp-primary px-2.5 py-1 text-sm font-bold text-white">
                {formatMoneyDisplay(addOn.price)}{typeof addOn.price === 'number' ? currency : ''}
              </span>
              {typeof addOn.price === 'number' && (
                <span className="text-xs text-slate-400">
                  {addOn.unit ? `/${addOn.unit}` : '/month'}
                </span>
              )}
            </>
          )}
        </div>
        {editable ? (
          <InlineDescription value={addOn.description ?? ''}
            onSave={(v) => onUpdate?.({ description: v || undefined })} />
        ) : (
          <p className={`mt-2 min-h-[2.5rem] px-1 py-0.5 text-xs leading-4 text-slate-500 dark:text-slate-400 ${addOn.description ? 'line-clamp-3' : ''}`}>{addOn.description || ''}</p>
        )}
      </div>

      {/* Available plans */}
      <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Available for</div>
        <div className="flex flex-wrap gap-1.5">
          {planKeys.map(pk => {
            const active = isAvailableFor(pk);
            const idx = planIndexMap[pk] ?? 0;
            const [a, b] = PALETTE[idx % PALETTE.length];
            if (editable) {
              return (
                <button key={pk} type="button" onClick={() => onToggleAvailableFor?.(pk)}
                  className={`cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
                    active ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-400 ring-1 ring-transparent hover:text-slate-600 dark:bg-slate-800 dark:text-slate-500 dark:hover:text-slate-400'
                  }`}
                  style={active ? { background: `linear-gradient(135deg, ${a}, ${b})`, boxShadow: `0 1px 3px ${a}40` } : undefined}>
                  {pk}
                </button>
              );
            }
            return (
              <span key={pk}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  active ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-400 ring-1 ring-transparent dark:bg-slate-800 dark:text-slate-500'
                }`}
                style={active ? { background: `linear-gradient(135deg, ${a}, ${b})`, boxShadow: `0 1px 3px ${a}40` } : undefined}>
                {pk}
              </span>
            );
          })}
        </div>
      </div>

      {/* Content sections */}
      {hasAnyContent && (
        <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="space-y-3">
            {featureEntries.length > 0 && (
              <div>
                <SectionHeader label="Features" count={featureEntries.length} editable={editable}
                  options={availableFeatures} placeholder="Add feature..."
                  onAdd={(key) => onUpdate?.({ features: { ...(addOn.features ?? {}), [key]: { value: (featureMap[key]?.defaultValue as string | number | boolean) ?? false } } })} />
                <div className="mt-1.5 space-y-1">
                  {featureEntries.map(([k, v]) => {
                    const vt = (featureMap[k]?.valueType as 'BOOLEAN' | 'TEXT' | 'NUMERIC') ?? 'BOOLEAN';
                    return (
                      <InlineValueRow key={k} label={k} value={v.value} valueType={vt} editable={editable}
                        onValueChange={editable ? (val) => {
                          const f = { ...(addOn.features ?? {}) };
                          f[k] = { value: val };
                          onUpdate?.({ features: f });
                        } : undefined}
                        onRemove={editable ? () => {
                          const f = { ...(addOn.features ?? {}) };
                          delete f[k];
                          onUpdate?.({ features: Object.keys(f).length > 0 ? f : undefined });
                        } : undefined} />
                    );
                  })}
                </div>
              </div>
            )}
            {usageEntries.length > 0 && (
              <div>
                <SectionHeader label="Usage Limits" count={usageEntries.length} editable={editable}
                  options={availableUsageLimits} placeholder="Add usage limit..."
                  onAdd={(key) => onUpdate?.({ usageLimits: { ...(addOn.usageLimits ?? {}), [key]: { value: (usageLimitMap[key]?.defaultValue as string | number | boolean) ?? 0 } } })} />
                <div className="mt-1.5 space-y-1">
                  {usageEntries.map(([k, v]) => {
                    const vt = (usageLimitMap[k]?.valueType as 'BOOLEAN' | 'TEXT' | 'NUMERIC') ?? 'NUMERIC';
                    return (
                      <InlineValueRow key={k} label={k} value={v.value} valueType={vt} editable={editable}
                        onValueChange={editable ? (val) => {
                          const u = { ...(addOn.usageLimits ?? {}) };
                          u[k] = { value: val };
                          onUpdate?.({ usageLimits: u });
                        } : undefined}
                        onRemove={editable ? () => {
                          const u = { ...(addOn.usageLimits ?? {}) };
                          delete u[k];
                          onUpdate?.({ usageLimits: Object.keys(u).length > 0 ? u : undefined });
                        } : undefined} />
                    );
                  })}
                </div>
              </div>
            )}
            {extensionEntries.length > 0 && (
              <div>
                <SectionHeader label="Extensions" count={extensionEntries.length} editable={editable}
                  options={availableExtensions} placeholder="Add extension..."
                  onAdd={(key) => onUpdate?.({ usageLimitsExtensions: { ...(addOn.usageLimitsExtensions ?? {}), [key]: { value: (usageLimitMap[key]?.defaultValue as string | number | boolean) ?? 0 } } })} />
                <div className="mt-1.5 space-y-1">
                  {extensionEntries.map(([k, v]) => {
                    const vt = (usageLimitMap[k]?.valueType as 'BOOLEAN' | 'TEXT' | 'NUMERIC') ?? 'NUMERIC';
                    return (
                      <InlineValueRow key={k} label={k} value={v.value} valueType={vt} editable={editable}
                        onValueChange={editable ? (val) => {
                          const e = { ...(addOn.usageLimitsExtensions ?? {}) };
                          e[k] = { value: val };
                          onUpdate?.({ usageLimitsExtensions: e });
                        } : undefined}
                        onRemove={editable ? () => {
                          const e = { ...(addOn.usageLimitsExtensions ?? {}) };
                          delete e[k];
                          onUpdate?.({ usageLimitsExtensions: Object.keys(e).length > 0 ? e : undefined });
                        } : undefined} />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dependencies footer */}
      {((addOn.dependsOn && addOn.dependsOn.length > 0) || (addOn.excludes && addOn.excludes.length > 0) || addOn.private) && (
        <div className="mt-auto border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <div className="flex flex-wrap gap-1.5">
            {addOn.private && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                <FaLock className="h-2 w-2" /> Private
              </span>
            )}
            {addOn.dependsOn?.map(d => (
              <span key={d} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                <FaLink className="h-2 w-2" /> {d}
              </span>
            ))}
            {addOn.excludes?.map(e => (
              <span key={e} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-500 dark:bg-red-900/30 dark:text-red-400">
                <FaArrowRightArrowLeft className="h-2 w-2" /> {e}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Empty state (editable only) */}
      {editable && !hasAnyContent && !addOn.description && (
        <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          <p className="text-center text-xs italic text-slate-300 dark:text-slate-600">Click any value to edit it inline</p>
        </div>
      )}
    </div>
  );
}

/* ── Main Card (with DnD for editor use) ── */
export function AddOnCard({
  editable = false,
  addOnKey, addOn, planKeys, planIndexMap, currency, featureMap, usageLimitMap,
  isDragging: isDraggingProp, isOverlay,
  onEdit, onRemove, onRename, onToggleAvailableFor, onUpdate,
}: AddOnCardProps): JSX.Element {
  if (!editable) {
    return (
      <AddOnCardContent
        addOnKey={addOnKey} addOn={addOn}
        planKeys={planKeys} planIndexMap={planIndexMap} currency={currency}
        editable={false}
        featureMap={featureMap} usageLimitMap={usageLimitMap}
      />
    );
  }

  return (
    <AddOnCardWithDnD
      addOnKey={addOnKey} addOn={addOn}
      planKeys={planKeys} planIndexMap={planIndexMap} currency={currency}
      editable
      featureMap={featureMap} usageLimitMap={usageLimitMap}
      isDragging={isDraggingProp} isOverlay={isOverlay}
      onEdit={onEdit} onRemove={onRemove} onRename={onRename}
      onToggleAvailableFor={onToggleAvailableFor} onUpdate={onUpdate}
    />
  );
}

/* ── Editable wrapper with DnD integration ── */
function AddOnCardWithDnD({
  addOnKey, addOn, planKeys, planIndexMap, currency, featureMap, usageLimitMap,
  isDragging: isDraggingProp, isOverlay,
  onEdit, onRemove, onRename, onToggleAvailableFor, onUpdate,
}: AddOnCardProps): JSX.Element {
  const sortable = useSortable({ id: addOnKey, disabled: isOverlay });
  const { attributes, listeners, setNodeRef, transform, transition } = sortable;
  const isDragging = isDraggingProp ?? sortable.isDragging;

  const style = isOverlay
    ? { boxShadow: '0 20px 60px rgba(0,0,0,0.15), 0 8px 20px rgba(0,0,0,0.1)', cursor: 'grabbing', transform: undefined, transition: undefined, zIndex: 999 }
    : {
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
        opacity: isDragging ? 0.35 : 1,
        zIndex: isDragging ? 50 : undefined,
      };

  return (
    <AddOnCardContent
      addOnKey={addOnKey} addOn={addOn}
      planKeys={planKeys} planIndexMap={planIndexMap} currency={currency}
      editable
      featureMap={featureMap} usageLimitMap={usageLimitMap}
      onEdit={onEdit} onRemove={onRemove} onRename={onRename}
      onToggleAvailableFor={onToggleAvailableFor} onUpdate={onUpdate}
      containerRef={isOverlay ? undefined : setNodeRef}
      containerStyle={style}
      dragListeners={isOverlay ? undefined : listeners}
      dragAttributes={isOverlay ? undefined : attributes}
    />
  );
}
