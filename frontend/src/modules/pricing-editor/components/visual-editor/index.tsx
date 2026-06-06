import { useState, useRef, useEffect, useMemo, useCallback, Fragment } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FaCheckCircle, FaTimesCircle } from 'react-icons/fa';
import { FaPlus, FaTrash, FaPencil, FaXmark, FaGripVertical, FaFloppyDisk, FaEye, FaEyeSlash } from 'react-icons/fa6';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext, useSortable, horizontalListSortingStrategy, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { UsageLimit } from 'pricing4ts';
import { camelToTitle } from '../pricing-renderer/shared/stringUtils';
import { formatUsageDisplay } from '../pricing-renderer/shared/value-helpers';
import PALETTE from '../pricing-renderer/shared/planPalette';
import {
  parseDraftFromYaml,
  toggleFeatureValue,
  setCellValue,
  updatePlanProps,
  updateRenderMode,
  addPlan,
  removePlan,
  renamePlan,
  ensureSyntaxVersion31,
} from '../../services/pricing2yaml';
import type { PricingDraft, DraftPlan, DraftFeature, DraftUsageLimit } from '../../services/pricing2yaml';

const CURRENCIES: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$',
  CHF: 'CHF', CNY: '¥', SEK: 'kr', NZD: 'NZ$',
};

const FAST_SPRING = { type: 'spring' as const, stiffness: 800, damping: 35 };

const FEATURE_TYPES = ['INFORMATION', 'INTEGRATION', 'DOMAIN', 'AUTOMATION', 'MANAGEMENT', 'GUARANTEE', 'SUPPORT', 'PAYMENT'] as const;
const VALUE_TYPES = ['BOOLEAN', 'TEXT', 'NUMERIC'] as const;
const USAGE_LIMIT_TYPES = ['RENEWABLE', 'NON_RENEWABLE'] as const;

const LABEL_WIDTH = 200;
const TRAILING_WIDTH = 60;

interface VisualPricingEditorProps {
  yaml: string;
  isDirty: boolean;
  onDraftChange: (draft: PricingDraft) => void;
  onSave: () => void;
}

/* ─── Inline editing for headers (dark bg) ─── */
function HeaderInlineEdit({
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
        className={`cursor-pointer rounded px-1 transition-colors hover:bg-white/20 ${className ?? ''}`}
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
      className="rounded bg-white/20 px-1 py-0.5 text-center text-sm font-semibold text-white outline-none ring-1 ring-white/30"
      style={{ width: `${Math.max(draft.length, 3)}ch` }}
    />
  );
}

/* ─── Inline editing for body cells (light bg) ─── */
function CellInlineEdit({
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
      className="w-full rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-center text-sm font-semibold text-slate-900 outline-none ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
    />
  );
}

/* ─── Inline name editing (alphanumeric only) ─── */
function NameInlineEdit({
  value, onSave, className,
}: {
  value: string; onSave: (newKey: string) => void; className?: string;
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
        className={`cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 ${className ?? ''}`}
      >{camelToTitle(value)}</span>
    );
  }

  return (
    <input ref={inputRef} type="text" value={draft}
      onChange={(e) => { const v = e.target.value.replace(/[^a-zA-Z0-9]/g, ''); setDraft(v); }}
      onBlur={() => { setEditing(false); if (draft && draft !== value) onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); if (draft && draft !== value) onSave(draft); }
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-full rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-slate-900 outline-none ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
    />
  );
}

/* ─── Add-row trigger between rows ─── */
function AddRowTrigger({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="group/addrow relative h-8 w-full cursor-pointer" onClick={onAdd}>
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center">
        <div className="flex w-full items-center opacity-0 transition-opacity group-hover/addrow:opacity-100">
          <div className="h-px flex-1 bg-orange-200 dark:bg-orange-800 transition-colors group-hover/addrow:bg-orange-400" />
          <span className="shrink-0 mx-2 rounded-full border border-dashed border-orange-300 bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-500 shadow-sm dark:border-orange-600 dark:bg-slate-900 dark:text-orange-400">
            {label}
          </span>
          <div className="h-px flex-1 bg-orange-200 dark:bg-orange-800 transition-colors group-hover/addrow:bg-orange-400" />
        </div>
      </div>
    </div>
  );
}

/* ─── Inline name input for new rows ─── */
function CreatingNameInput({ initialKey, onConfirm, onCancel }: {
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
      onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
      onBlur={() => { const k = name.trim().replace(/[^a-zA-Z0-9]/g, ''); if (k && k !== initialKey) onConfirm(k); else onCancel(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { const k = name.trim().replace(/[^a-zA-Z0-9]/g, ''); if (k) onConfirm(k); else onCancel(); }
        if (e.key === 'Escape') onCancel();
      }}
      className="w-full rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-slate-900 outline-none ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
    />
  );
}

/* ─── Side panel base ─── */
function SidePanel({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="fixed right-0 top-0 z-50 flex h-full w-[360px] flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
          <button type="button" onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          ><FaXmark className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-700">{footer}</div>
      </motion.div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white";

/* ─── Plan side panel ─── */
function PlanSidePanel({ planKey, plan, currency, onClose, onSave }: {
  planKey: string; plan: DraftPlan; currency: string;
  onClose: () => void; onSave: (key: string, updates: Partial<{ description: string; price: number | string; unit: string }>) => void;
}) {
  const [name, setName] = useState(planKey);
  const [price, setPrice] = useState(String(plan.price ?? 0));
  const [unit, setUnit] = useState(plan.unit ?? '');
  const [description, setDescription] = useState(plan.description ?? '');
  return (
    <SidePanel title="Edit Plan" onClose={onClose} footer={
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="cursor-pointer flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Cancel</button>
        <button type="button" onClick={() => { const p = price === '' ? 0 : Number(price); onSave(name, { price: Number.isNaN(p) ? 0 : p, unit, description }); onClose(); }}
          className="cursor-pointer flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">Save</button>
      </div>
    }>
      <div className="space-y-5">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
        <Field label={`Price (${currency})`}><input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} /></Field>
        <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. user/month" className={inputCls} /></Field>
        <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} /></Field>
      </div>
    </SidePanel>
  );
}

/* ─── Feature / Usage Limit side panel ─── */
function FeatureSidePanel({ entityKey, entity, isFeature, onClose, onSave, onConvert }: {
  entityKey: string; entity: DraftFeature | DraftUsageLimit; isFeature: boolean;
  onClose: () => void;
  onSave: (key: string, updates: Record<string, unknown>) => void;
  onConvert: (key: string, toType: 'feature' | 'usageLimit') => void;
}) {
  const [name, setName] = useState(entityKey);
  const [description, setDescription] = useState(entity.description ?? '');

  const f = isFeature ? entity as DraftFeature : null;
  const [valueType, setValueType] = useState(f?.valueType ?? 'BOOLEAN');
  const [defaultValue, setDefaultValue] = useState(String(f?.defaultValue ?? ''));
  const [featureType, setFeatureType] = useState(f?.type ?? 'DOMAIN');
  const [expression, setExpression] = useState(f?.expression ?? '');

  const u = !isFeature ? entity as DraftUsageLimit : null;
  const [ulValueType, setUlValueType] = useState(u?.valueType ?? 'NUMERIC');
  const [ulDefault, setUlDefault] = useState(String(u?.defaultValue ?? '0'));
  const [unit, setUnit] = useState(u?.unit ?? '');
  const [ulType, setUlType] = useState<'RENEWABLE' | 'NON_RENEWABLE'>(u?.type ?? 'RENEWABLE');

  return (
    <SidePanel title={isFeature ? 'Edit Feature' : 'Edit Usage Limit'} onClose={onClose} footer={
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="cursor-pointer flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Cancel</button>
        <button type="button" onClick={() => {
          if (isFeature) {
            onSave(name, { description, valueType, defaultValue: valueType === 'BOOLEAN' ? defaultValue === 'true' : valueType === 'NUMERIC' ? Number(defaultValue) || 0 : defaultValue, type: featureType, expression: expression || undefined });
          } else {
            onSave(name, { description, valueType: ulValueType, defaultValue: ulValueType === 'NUMERIC' ? Number(ulDefault) || 0 : ulDefault, unit, type: ulType });
          }
          onClose();
        }} className="cursor-pointer flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">Save</button>
      </div>
    }>
      <div className="space-y-5">
        <Field label="Key"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
        <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} /></Field>

        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Convert to:</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => onConvert(entityKey, 'feature')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${isFeature ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-400'}`}
            >Feature</button>
            <button type="button" onClick={() => onConvert(entityKey, 'usageLimit')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${!isFeature ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-400'}`}
            >Usage Limit</button>
          </div>
        </div>

        {isFeature ? (
          <>
            <Field label="Value Type">
              <select value={valueType} onChange={(e) => setValueType(e.target.value as typeof valueType)} className={inputCls}>
                {VALUE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Default Value">
              {valueType === 'BOOLEAN' ? (
                <select value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} className={inputCls}>
                  <option value="true">true</option><option value="false">false</option>
                </select>
              ) : <input value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} className={inputCls} />}
            </Field>
            <Field label="Feature Type">
              <select value={featureType} onChange={(e) => setFeatureType(e.target.value)} className={inputCls}>
                {FEATURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Expression (optional)"><input value={expression} onChange={(e) => setExpression(e.target.value)} placeholder="pricingContext['features']..." className={inputCls} /></Field>
          </>
        ) : (
          <>
            <Field label="Value Type">
              <select value={ulValueType} onChange={(e) => setUlValueType(e.target.value as typeof ulValueType)} className={inputCls}>
                {VALUE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Default Value">
              <input type={ulValueType === 'NUMERIC' ? 'number' : 'text'} value={ulDefault} onChange={(e) => setUlDefault(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. GB, pet, visit" className={inputCls} /></Field>
            <Field label="Limit Type">
              <select value={ulType} onChange={(e) => setUlType(e.target.value as typeof ulType)} className={inputCls}>
                {USAGE_LIMIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </>
        )}
      </div>
    </SidePanel>
  );
}

/* ─── Usage limit creation side panel ─── */
function UsageLimitSidePanel({ featureKeys, onClose, onSave }: {
  featureKeys: string[];
  onClose: () => void;
  onSave: (data: { name: string; unit: string; linkedFeature: string; type: 'RENEWABLE' | 'NON_RENEWABLE'; defaultValue: number }) => void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [linkedFeature, setLinkedFeature] = useState('');
  const [ulType, setUlType] = useState<'RENEWABLE' | 'NON_RENEWABLE'>('RENEWABLE');
  const [defaultValue, setDefaultValue] = useState('0');
  const [error, setError] = useState('');

  const handleSave = () => {
    const trimmedName = name.trim().replace(/\s+/g, '');
    if (!trimmedName) { setError('Name is required'); return; }
    if (!linkedFeature) { setError('Please select a feature to link'); return; }
    setError('');
    onSave({ name: trimmedName, unit: unit.trim() || 'unit', linkedFeature, type: ulType, defaultValue: Number(defaultValue) || 0 });
  };

  return (
    <SidePanel title="Create Usage Limit" onClose={onClose} footer={
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="cursor-pointer flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Cancel</button>
        <button type="button" onClick={handleSave}
          className="cursor-pointer flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700">Create</button>
      </div>
    }>
      <div className="space-y-5">
        {error && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
          >{error}</motion.div>
        )}
        <Field label="Key"><input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="e.g. maxStorage" className={inputCls} /></Field>
        <Field label="Linked Feature *">
          <select value={linkedFeature} onChange={(e) => { setLinkedFeature(e.target.value); setError(''); }} className={inputCls}>
            <option value="">Select a feature...</option>
            {featureKeys.map(fk => <option key={fk} value={fk}>{camelToTitle(fk)}</option>)}
          </select>
        </Field>
        <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. GB, pet, visit" className={inputCls} /></Field>
        <Field label="Default Value"><input type="number" value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} className={inputCls} /></Field>
        <Field label="Limit Type">
          <select value={ulType} onChange={(e) => setUlType(e.target.value as typeof ulType)} className={inputCls}>
            <option value="RENEWABLE">RENEWABLE</option>
            <option value="NON_RENEWABLE">NON_RENEWABLE</option>
          </select>
        </Field>
      </div>
    </SidePanel>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/* ─── Sortable Plan Header Cell ─── */
/* ════════════════════════════════════════════════════════════════════ */
function SortablePlanHeader({
  planKey, index, plan, currency, isHovered, onHover, onEdit, onRemove, onPriceChange, onUnitChange, canRemove,
}: {
  planKey: string; index: number; plan: DraftPlan; currency: string;
  isHovered: boolean; onHover: (hovered: boolean) => void;
  onEdit: () => void; onRemove: () => void;
  onPriceChange: (v: string) => void; onUnitChange: (v: string) => void;
  canRemove: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: planKey });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const [a, b] = PALETTE[index % PALETTE.length];

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="group relative shrink-0 grow border-b border-r border-slate-200 px-2 py-0 dark:border-slate-700"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="absolute inset-0 rounded-t-lg" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
      <div className="relative flex flex-col items-center py-4 text-center">
        <div {...listeners} className="absolute left-1 top-2 cursor-grab text-white/40 hover:text-white/80 active:cursor-grabbing">
          <FaGripVertical className="h-3 w-3" />
        </div>
        <div className="relative">
          <span className="cursor-pointer rounded px-2 py-0.5 text-white transition-colors hover:bg-white/20">
            {planKey.toUpperCase()}
          </span>
        </div>
        <div className="mt-1">
          {plan.price === 0 ? (
            <span className="text-base font-bold text-white/90">FREE</span>
          ) : (
            <span className="flex items-center text-base font-bold text-white">
              <HeaderInlineEdit value={String(plan.price)} onSave={onPriceChange} className="!text-base !font-bold !text-white" numeric selectOnFocus />
              <span className="ml-0.5 text-sm font-normal text-white/70">{currency}</span>
            </span>
          )}
        </div>
        {plan.unit && <div className="mt-0.5"><HeaderInlineEdit value={plan.unit} onSave={onUnitChange} className="!text-xs !text-white/70" /></div>}
      </div>
      {isHovered && (
        <div className="absolute right-1 top-1 z-10 flex gap-0.5">
          <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} type="button"
            onClick={onEdit}
            className="cursor-pointer rounded-md bg-white/20 p-1 text-white/70 backdrop-blur-sm transition-colors hover:bg-white/30 hover:text-white"
            title="Edit plan details"><FaPencil className="h-2.5 w-2.5" /></motion.button>
          {canRemove && (
            <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} type="button"
              onClick={onRemove}
              className="cursor-pointer rounded-md bg-red-500/20 p-1 text-red-200 backdrop-blur-sm transition-colors hover:bg-red-500/40 hover:text-red-100"
              title="Remove plan"><FaTrash className="h-2.5 w-2.5" /></motion.button>
          )}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/* ─── Sortable Feature Row ─── */
/* ════════════════════════════════════════════════════════════════════ */
function SortableFeatureRow({
  featureKey, feature, planKeys, draft,
  onToggle, onSetCellValue, onEdit, onRemove, onToggleRender, onRename,
  isCreating, onCreatingConfirm, onCreatingCancel,
}: {
  featureKey: string; feature: DraftFeature;
  planKeys: string[]; draft: PricingDraft;
  onToggle: (planKey: string, featureKey: string) => void;
  onSetCellValue: (planKey: string, cellType: 'feature' | 'usageLimit', cellKey: string, value: string | number | boolean) => void;
  onEdit: () => void; onRemove: () => void;
  onToggleRender: (entityType: 'feature' | 'usageLimit', key: string) => void;
  onRename: (oldKey: string, newKey: string) => void;
  isCreating?: boolean;
  onCreatingConfirm?: (newKey: string) => void;
  onCreatingCancel?: () => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: featureKey });
  const [creatingName, setCreatingName] = useState(featureKey);
  const creatingInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating && creatingInputRef.current) {
      creatingInputRef.current.focus();
      creatingInputRef.current.select();
    }
  }, [isCreating]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const isDisabled = feature.render === 'disabled';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group"
    >
      <div className={`flex ${isDisabled ? 'opacity-[0.6]' : ''}`} style={{ width: '100%' }}>
        {/* Label cell */}
        <div className="relative flex shrink-0 items-center gap-1.5 border-b border-r border-slate-200 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50"
          style={{ width: LABEL_WIDTH }}>
          {isCreating ? (
            <input ref={creatingInputRef} value={creatingName}
              onChange={(e) => setCreatingName(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
              onBlur={() => { const k = creatingName.trim().replace(/[^a-zA-Z0-9]/g, ''); if (k && k !== featureKey) onCreatingConfirm?.(k); else onCreatingCancel?.(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { const k = creatingName.trim().replace(/[^a-zA-Z0-9]/g, ''); if (k) onCreatingConfirm?.(k); else onCreatingCancel?.(); }
                if (e.key === 'Escape') onCreatingCancel?.();
              }}
              className="w-full rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-slate-900 outline-none ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
            />
          ) : (
            <>
              <div {...listeners} className="cursor-grab text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-500 active:cursor-grabbing">
                <FaGripVertical className="h-3 w-3" />
              </div>
              <NameInlineEdit value={featureKey} onSave={(newKey) => onRename(featureKey, newKey)}
                className="text-sm font-semibold text-slate-700 dark:text-slate-300" />
            </>
          )}
          <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button type="button" onClick={() => onToggleRender('feature', featureKey)}
              className={`cursor-pointer rounded p-0.5 transition-colors ${isDisabled ? 'text-slate-300 hover:text-amber-500' : 'text-amber-500 hover:text-slate-400'}`}
              title={isDisabled ? 'Show row' : 'Hide row'}>
              {isDisabled ? <FaEyeSlash className="h-2.5 w-2.5" /> : <FaEye className="h-2.5 w-2.5" />}
            </button>
            <button type="button" onClick={onEdit}
              className="cursor-pointer rounded p-0.5 text-slate-400 transition-colors hover:text-indigo-500" title="Edit">
              <FaPencil className="h-2.5 w-2.5" />
            </button>
            <button type="button" onClick={onRemove}
              className="cursor-pointer rounded p-0.5 text-slate-400 transition-colors hover:text-red-500" title="Remove">
              <FaTrash className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

        {/* Value cells */}
        {planKeys.map((planKey, pIdx) => {
          const plan = draft.plans[planKey];
          if (plan?.private) return <div key={planKey} className="grow min-w-[140px] border-b border-r border-slate-100 dark:border-slate-800" />;
          const featureValue = (plan?.features as Record<string, { value: unknown }> | undefined)?.[featureKey]?.value;
          const globalDefault = feature.defaultValue;
          const effectiveValue = featureValue ?? globalDefault;
          const toneClass = pIdx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/50';

          if (typeof effectiveValue === 'boolean') {
            return (
              <div key={planKey} className={`flex grow min-w-[140px] items-center justify-center border-b border-r border-slate-100 px-2 py-3 dark:border-slate-800 ${toneClass}`}>
                <motion.div className="flex cursor-pointer items-center justify-center"
                  onClick={() => onToggle(planKey, featureKey)}
                  whileTap={{ scale: 0.8 }} transition={FAST_SPRING}
                >
                  <AnimatePresence mode="wait">
                    {effectiveValue ? (
                      <motion.div key="on" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={FAST_SPRING}>
                        <FaCheckCircle className="text-lg text-emerald-500" />
                      </motion.div>
                    ) : (
                      <motion.div key="off" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={FAST_SPRING}>
                        <FaTimesCircle className="text-lg text-slate-300 dark:text-slate-600" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>
            );
          }

          const strVal = effectiveValue !== undefined && effectiveValue !== null && effectiveValue !== '' ? String(effectiveValue) : '';
          const isNumeric = typeof effectiveValue === 'number' || feature.valueType === 'NUMERIC';

          return (
            <div key={planKey} className={`flex grow min-w-[140px] items-center justify-center border-b border-r border-slate-100 px-2 py-3 dark:border-slate-800 ${toneClass}`}>
              {strVal ? (
                <CellInlineEdit value={strVal} numeric={isNumeric}
                  onSave={(v) => { const p = isNumeric ? (v === '' ? 0 : Number(v)) : v; onSetCellValue(planKey, 'feature', featureKey, Number.isNaN(p) ? v : p); }}
                  className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300"
                />
              ) : (
                <FaTimesCircle className="text-slate-300 dark:text-slate-600" />
              )}
            </div>
          );
        })}

        {/* Empty trailing cell */}
        <div className="shrink-0 border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800" style={{ width: TRAILING_WIDTH }} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/* ─── Sortable Usage Limit Row ─── */
/* ════════════════════════════════════════════════════════════════════ */
function SortableUsageLimitRow({
  usageKey, usage, planKeys, draft,
  onToggleRender, onEdit, onRename,
  isCreating, onCreatingConfirm, onCreatingCancel,
}: {
  usageKey: string; usage: DraftUsageLimit;
  planKeys: string[]; draft: PricingDraft;
  onToggleRender: (entityType: 'feature' | 'usageLimit', key: string) => void;
  onEdit: () => void;
  onRename: (oldKey: string, newKey: string) => void;
  isCreating?: boolean;
  onCreatingConfirm?: (newKey: string) => void;
  onCreatingCancel?: () => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: usageKey });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const isDisabled = usage.render === 'disabled';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group"
    >
      <div className={`flex ${isDisabled ? 'opacity-[0.6]' : ''}`} style={{ width: '100%' }}>
        {/* Label */}
        <div className="relative flex shrink-0 items-center gap-1.5 border-b border-r border-slate-200 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50"
          style={{ width: LABEL_WIDTH }}>
          {isCreating ? (
            <CreatingNameInput
              initialKey={usageKey}
              onConfirm={onCreatingConfirm!}
              onCancel={onCreatingCancel!}
            />
          ) : (
            <>
              <div {...listeners} className="cursor-grab text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-500 active:cursor-grabbing">
                <FaGripVertical className="h-3 w-3" />
              </div>
              <NameInlineEdit value={usageKey} onSave={(newKey) => onRename(usageKey, newKey)}
                className="text-sm font-semibold text-slate-700 dark:text-slate-300" />
              <span className="text-xs text-slate-400 dark:text-slate-500">({usage.unit})</span>
            </>
          )}
          <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button type="button" onClick={() => onToggleRender('usageLimit', usageKey)}
              className={`cursor-pointer rounded p-0.5 transition-colors ${isDisabled ? 'text-slate-300 hover:text-amber-500' : 'text-amber-500 hover:text-slate-400'}`}
              title={isDisabled ? 'Show row' : 'Hide row'}>
              {isDisabled ? <FaEyeSlash className="h-2.5 w-2.5" /> : <FaEye className="h-2.5 w-2.5" />}
            </button>
            <button type="button" onClick={onEdit}
              className="cursor-pointer rounded p-0.5 text-slate-400 transition-colors hover:text-indigo-500" title="Edit">
              <FaPencil className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
        {/* Values */}
        {planKeys.map((planKey, pIdx) => {
          const plan = draft.plans[planKey];
          if (plan?.private) return <div key={planKey} className="grow min-w-[140px] border-b border-r border-slate-100 dark:border-slate-800" />;
          const usageValue = (plan?.usageLimits as Record<string, { value: unknown }> | undefined)?.[usageKey]?.value;
          const effectiveValue = usageValue ?? usage.defaultValue;
          const toneClass = pIdx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/50';
          const strVal = effectiveValue !== undefined && effectiveValue !== null && effectiveValue !== 0 ? String(effectiveValue) : '';
          return (
            <div key={planKey} className={`flex grow min-w-[140px] items-center justify-center border-b border-r border-slate-100 px-2 py-3 dark:border-slate-800 ${toneClass}`}>
              {strVal ? (
                <span className="inline-flex items-center justify-center rounded-full bg-indigo-500 px-4 py-1.5 text-sm font-bold text-white">
                  {formatUsageDisplay(effectiveValue, usage as unknown as UsageLimit)}
                </span>
              ) : (
                <FaTimesCircle className="text-slate-300 dark:text-slate-600" />
              )}
            </div>
          );
        })}
        <div className="shrink-0 border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800" style={{ width: TRAILING_WIDTH }} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/* ─── Main Visual Editor ─── */
/* ════════════════════════════════════════════════════════════════════ */
export default function VisualPricingEditor({ yaml, isDirty, onDraftChange, onSave }: VisualPricingEditorProps) {
  const [draft, setDraft] = useState<PricingDraft>(() => parseDraftFromYaml(ensureSyntaxVersion31(yaml)));
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);

  // Plan editing
  const [editingPlan, setEditingPlan] = useState<string | null>(null);

  // Feature / Usage limit editing
  const [editingFeature, setEditingFeature] = useState<string | null>(null);
  const [creatingRowKey, setCreatingRowKey] = useState<string | null>(null);

  // Usage limit creation panel (for side panel fallback)
  const [creatingUsageLimit, setCreatingUsageLimit] = useState(false);

  // Reorderable keys
  const [planOrder, setPlanOrder] = useState<string[] | null>(null);
  const [featureOrder, setFeatureOrder] = useState<string[] | null>(null);
  const [usageLimitOrder, setUsageLimitOrder] = useState<string[] | null>(null);

  const planKeys = useMemo(() => {
    const base = Object.keys(draft.plans ?? {});
    if (planOrder) return planOrder.filter(k => base.includes(k)).concat(base.filter(k => !planOrder.includes(k)));
    return base;
  }, [draft.plans, planOrder]);

  const featureKeys = useMemo(() => {
    const base = Object.keys(draft.features ?? {});
    if (featureOrder) return featureOrder.filter(k => base.includes(k)).concat(base.filter(k => !featureOrder.includes(k)));
    return base;
  }, [draft.features, featureOrder]);

  const usageLimitKeys = useMemo(() => {
    const base = Object.keys(draft.usageLimits ?? {});
    if (usageLimitOrder) return usageLimitOrder.filter(k => base.includes(k)).concat(base.filter(k => !usageLimitOrder.includes(k)));
    return base;
  }, [draft.usageLimits, usageLimitOrder]);

  const featureMap = useMemo(() => {
    const m: Record<string, DraftFeature> = {};
    for (const [k, v] of Object.entries(draft.features ?? {})) m[k] = v;
    return m;
  }, [draft.features]);

  const usageLimitMap = useMemo(() => {
    const m: Record<string, DraftUsageLimit> = {};
    for (const [k, v] of Object.entries(draft.usageLimits ?? {})) m[k] = v;
    return m;
  }, [draft.usageLimits]);

  const resolvedCurrency = draft.currency && draft.currency in CURRENCIES ? CURRENCIES[draft.currency] : draft.currency ?? '';

  const visiblePlanKeys = useMemo(() => planKeys.filter(pk => !draft.plans[pk]?.private), [planKeys, draft.plans]);

  /* ── dnd-kit sensors ── */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor),
  );

  /* ── Mutations ── */
  const applyMutation = useCallback((mutated: PricingDraft) => {
    setDraft(mutated);
    onDraftChange(mutated);
  }, [onDraftChange]);

  const handleToggleFeature = useCallback((planKey: string, featureKey: string) => {
    applyMutation(toggleFeatureValue(draft, planKey, featureKey));
  }, [draft, applyMutation]);

  const handleSetCellValue = useCallback((planKey: string, cellType: 'feature' | 'usageLimit', cellKey: string, value: string | number | boolean) => {
    applyMutation(setCellValue(draft, planKey, cellType, cellKey, value));
  }, [draft, applyMutation]);

  const handlePlanPriceChange = useCallback((planKey: string, priceStr: string) => {
    const price = priceStr === '' ? 0 : Number(priceStr);
    if (!Number.isNaN(price)) applyMutation(updatePlanProps(draft, planKey, { price }));
  }, [draft, applyMutation]);

  const handlePlanUnitChange = useCallback((planKey: string, unit: string) => {
    applyMutation(updatePlanProps(draft, planKey, { unit }));
  }, [draft, applyMutation]);

  const handleToggleRender = useCallback((entityType: 'feature' | 'usageLimit', key: string) => {
    const entity = entityType === 'feature' ? draft.features[key] : draft.usageLimits?.[key];
    if (!entity) return;
    const current = entity.render ?? 'auto';
    const next = current === 'disabled' ? 'enabled' : current === 'enabled' ? 'auto' : 'disabled';
    applyMutation(updateRenderMode(draft, entityType, key, next));
  }, [draft, applyMutation]);

  const handleRename = useCallback((entityType: 'feature' | 'usageLimit', oldKey: string, newKey: string) => {
    if (oldKey === newKey || !newKey) return;
    const mutated = structuredClone(draft);
    if (entityType === 'feature') {
      if (mutated.features[newKey]) return;
      mutated.features[newKey] = mutated.features[oldKey];
      delete mutated.features[oldKey];
      for (const plan of Object.values(mutated.plans)) {
        if (plan.features?.[oldKey]) { plan.features[newKey] = plan.features[oldKey]; delete plan.features[oldKey]; }
      }
      if (mutated.usageLimits) {
        for (const ul of Object.values(mutated.usageLimits)) {
          if (ul.linkedFeatures) ul.linkedFeatures = ul.linkedFeatures.map(f => f === oldKey ? newKey : f);
        }
      }
    } else {
      if (!mutated.usageLimits) return;
      if (mutated.usageLimits[newKey]) return;
      mutated.usageLimits[newKey] = mutated.usageLimits[oldKey];
      delete mutated.usageLimits[oldKey];
      for (const plan of Object.values(mutated.plans)) {
        if (plan.usageLimits?.[oldKey]) { plan.usageLimits[newKey] = plan.usageLimits[oldKey]; delete plan.usageLimits[oldKey]; }
      }
    }
    applyMutation(mutated);
  }, [draft, applyMutation]);

  /* ── Helper: next available name ── */
  const getNextName = useCallback((prefix: string, existingKeys: string[]) => {
    let i = 1;
    while (existingKeys.includes(`${prefix}${i}`)) i++;
    return `${prefix}${i}`;
  }, []);

  /* ── Plan operations ── */
  const handleAddPlan = useCallback(() => {
    const name = getNextName('plan', Object.keys(draft.plans));
    applyMutation(addPlan(draft, name));
  }, [draft, applyMutation, getNextName]);

  const handleRemovePlan = useCallback((planKey: string) => {
    applyMutation(removePlan(draft, planKey));
  }, [draft, applyMutation]);

  /* ── Feature operations ── */
  const handleAddFeature = useCallback(() => {
    const name = getNextName('feature', Object.keys(draft.features));
    const mutated = structuredClone(draft);
    mutated.features[name] = { valueType: 'BOOLEAN', defaultValue: false, type: 'DOMAIN' };
    for (const plan of Object.values(mutated.plans)) {
      if (plan.features !== null && plan.features !== undefined) {
        plan.features[name] = { value: false };
      }
    }
    applyMutation(mutated);
    setCreatingRowKey(name);
  }, [draft, applyMutation, getNextName]);

  const handleAddUsageLimitInline = useCallback(() => {
    const name = getNextName('usageLimit', Object.keys(draft.usageLimits ?? {}));
    const mutated = structuredClone(draft);
    if (!mutated.usageLimits) mutated.usageLimits = {};
    mutated.usageLimits[name] = {
      description: '', valueType: 'NUMERIC', defaultValue: 0,
      unit: 'unit', type: 'RENEWABLE', linkedFeatures: [],
    };
    for (const plan of Object.values(mutated.plans)) {
      if (plan.usageLimits !== null && plan.usageLimits !== undefined) {
        plan.usageLimits[name] = { value: 0 };
      }
    }
    applyMutation(mutated);
    setCreatingRowKey(name);
  }, [draft, applyMutation, getNextName]);

  const handleCreatingConfirm = useCallback((newKey: string) => {
    if (!creatingRowKey) return;
    if (newKey !== creatingRowKey && !draft.features[newKey] && !(draft.usageLimits ?? {})[newKey]) {
      const isFeature = creatingRowKey in draft.features;
      const mutated = structuredClone(draft);
      if (isFeature) {
        mutated.features[newKey] = mutated.features[creatingRowKey];
        delete mutated.features[creatingRowKey];
        for (const plan of Object.values(mutated.plans)) {
          if (plan.features?.[creatingRowKey]) { plan.features[newKey] = plan.features[creatingRowKey]; delete plan.features[creatingRowKey]; }
        }
      } else {
        if (!mutated.usageLimits) mutated.usageLimits = {};
        mutated.usageLimits[newKey] = mutated.usageLimits[creatingRowKey];
        delete mutated.usageLimits[creatingRowKey];
        for (const plan of Object.values(mutated.plans)) {
          if (plan.usageLimits?.[creatingRowKey]) { plan.usageLimits[newKey] = plan.usageLimits[creatingRowKey]; delete plan.usageLimits[creatingRowKey]; }
        }
      }
      applyMutation(mutated);
    }
    setCreatingRowKey(null);
  }, [creatingRowKey, draft, applyMutation]);

  const handleCreatingCancel = useCallback(() => {
    if (!creatingRowKey) return;
    const isFeature = creatingRowKey in draft.features;
    const mutated = structuredClone(draft);
    if (isFeature) {
      delete mutated.features[creatingRowKey];
      for (const plan of Object.values(mutated.plans)) {
        if (plan.features) delete plan.features[creatingRowKey];
      }
    } else {
      if (mutated.usageLimits) delete mutated.usageLimits[creatingRowKey];
      for (const plan of Object.values(mutated.plans)) {
        if (plan.usageLimits) delete plan.usageLimits[creatingRowKey];
      }
    }
    applyMutation(mutated);
    setCreatingRowKey(null);
  }, [creatingRowKey, draft, applyMutation]);

  const handleRemoveFeature = useCallback((featureKey: string) => {
    const mutated = structuredClone(draft);
    delete mutated.features[featureKey];
    for (const plan of Object.values(mutated.plans)) {
      if (plan.features) delete plan.features[featureKey];
    }
    if (mutated.usageLimits) {
      for (const ul of Object.values(mutated.usageLimits)) {
        if (ul.linkedFeatures) ul.linkedFeatures = ul.linkedFeatures.filter(f => f !== featureKey);
      }
    }
    applyMutation(mutated);
  }, [draft, applyMutation]);

  const handleConvertEntity = useCallback((key: string, toType: 'feature' | 'usageLimit') => {
    const mutated = structuredClone(draft);
    if (toType === 'usageLimit' && mutated.features[key]) {
      const f = mutated.features[key];
      if (!mutated.usageLimits) mutated.usageLimits = {};
      mutated.usageLimits[key] = {
        description: f.description, valueType: f.valueType === 'BOOLEAN' ? 'NUMERIC' : f.valueType as 'NUMERIC' | 'TEXT',
        defaultValue: f.valueType === 'BOOLEAN' ? 0 : (f.defaultValue as string | number),
        unit: 'unit', type: 'RENEWABLE', linkedFeatures: [key],
      };
      delete mutated.features[key];
      for (const plan of Object.values(mutated.plans)) {
        if (plan.features) delete plan.features[key];
        if (plan.usageLimits !== null && plan.usageLimits !== undefined) plan.usageLimits[key] = { value: 0 };
      }
    } else if (toType === 'feature' && mutated.usageLimits?.[key]) {
      const u = mutated.usageLimits[key];
      mutated.features[key] = {
        description: u.description, valueType: u.valueType === 'NUMERIC' ? 'BOOLEAN' : u.valueType as 'BOOLEAN' | 'TEXT',
        defaultValue: u.valueType === 'NUMERIC' ? false : (u.defaultValue as string | boolean),
        type: 'DOMAIN',
      };
      delete mutated.usageLimits[key];
      for (const plan of Object.values(mutated.plans)) {
        if (plan.features) plan.features[key] = { value: false };
        if (plan.usageLimits) delete plan.usageLimits[key];
      }
    }
    applyMutation(mutated);
  }, [draft, applyMutation]);

  const handleSaveEntity = useCallback((key: string, updates: Record<string, unknown>) => {
    const mutated = structuredClone(draft);
    if (mutated.features[key]) {
      Object.assign(mutated.features[key], updates);
      const newName = updates.name as string | undefined;
      if (newName && newName !== key && !mutated.features[newName]) {
        mutated.features[newName] = mutated.features[key];
        delete mutated.features[key];
        for (const plan of Object.values(mutated.plans)) {
          if (plan.features?.[key]) { plan.features[newName] = plan.features[key]; delete plan.features[key]; }
        }
      }
    } else if (mutated.usageLimits?.[key]) {
      Object.assign(mutated.usageLimits[key], updates);
    }
    applyMutation(mutated);
  }, [draft, applyMutation]);

  /* ── DnD handlers ── */
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Plan column reorder
    if (planKeys.includes(activeId) && planKeys.includes(overId)) {
      const oldIndex = planKeys.indexOf(activeId);
      const newIndex = planKeys.indexOf(overId);
      const newOrder = arrayMove(planKeys, oldIndex, newIndex);
      setPlanOrder(newOrder);
      const reordered: Record<string, PricingDraft['plans'][string]> = {};
      for (const k of newOrder) reordered[k] = draft.plans[k];
      applyMutation({ ...draft, plans: reordered });
      return;
    }

    // Feature row reorder
    if (featureKeys.includes(activeId) && featureKeys.includes(overId)) {
      const oldIndex = featureKeys.indexOf(activeId);
      const newIndex = featureKeys.indexOf(overId);
      const newOrder = arrayMove(featureKeys, oldIndex, newIndex);
      setFeatureOrder(newOrder);
      const reordered: Record<string, PricingDraft['features'][string]> = {};
      for (const k of newOrder) reordered[k] = draft.features[k];
      applyMutation({ ...draft, features: reordered });
      return;
    }

    // Usage limit row reorder
    if (usageLimitKeys.includes(activeId) && usageLimitKeys.includes(overId)) {
      const oldIndex = usageLimitKeys.indexOf(activeId);
      const newIndex = usageLimitKeys.indexOf(overId);
      const newOrder = arrayMove(usageLimitKeys, oldIndex, newIndex);
      setUsageLimitOrder(newOrder);
      const reordered: Record<string, DraftUsageLimit> = {};
      for (const k of newOrder) reordered[k] = draft.usageLimits![k];
      applyMutation({ ...draft, usageLimits: reordered });
    }
  }, [planKeys, featureKeys, usageLimitKeys, draft, applyMutation]);

  /* ── Keyboard shortcut ── */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty) onSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, onSave]);

  const editingPlanData = editingPlan ? draft.plans[editingPlan] ?? null : null;
  const editingFeatureData = editingFeature ? (draft.features[editingFeature] ?? draft.usageLimits?.[editingFeature]) : null;
  const editingFeatureIsFeature = editingFeature ? editingFeature in draft.features : false;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }}
        className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-6 py-3 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/80"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{draft.saasName}</span>
          {draft.currency && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">{draft.currency}</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{visiblePlanKeys.length} plans</span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span>{featureKeys.length} features</span>
          {usageLimitKeys.length > 0 && <><span className="text-slate-300 dark:text-slate-600">|</span><span>{usageLimitKeys.length} limits</span></>}
          <motion.button
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            type="button" onClick={onSave} disabled={!isDirty}
            className={`ml-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              isDirty ? 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700'
                : 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600'
            }`}
            title="Save changes (Ctrl+S)"
          >
            <FaFloppyDisk className="h-3 w-3" /> Save
          </motion.button>
        </div>
      </motion.div>

      {/* Grid table */}
      <div className="flex-[0.9] overflow-auto p-4 sm:p-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }} className="mx-auto flex h-full max-w-7xl flex-col">
          <div className="overflow-x-auto overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              {/* Header row */}
              <div className="flex shrink-0 border-b border-slate-200 dark:border-slate-700" style={{ minWidth: 'min-content' }}>
                {/* Corner cell */}
                <div className="shrink-0 border-r border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800" style={{ width: LABEL_WIDTH }} />

                {/* Plan headers */}
                <SortableContext items={visiblePlanKeys} strategy={horizontalListSortingStrategy}>
                  {visiblePlanKeys.map((planKey, index) => (
                    <SortablePlanHeader
                      key={planKey}
                      planKey={planKey}
                      index={index}
                      plan={draft.plans[planKey]}
                      currency={resolvedCurrency}
                      isHovered={hoveredCol === index}
                      onHover={(h) => setHoveredCol(h ? index : null)}
                      onEdit={() => setEditingPlan(planKey)}
                      onRemove={() => handleRemovePlan(planKey)}
                      onPriceChange={(v) => handlePlanPriceChange(planKey, v)}
                      onUnitChange={(v) => handlePlanUnitChange(planKey, v)}
                      canRemove={visiblePlanKeys.length > 1}
                    />
                  ))}
                </SortableContext>

                {/* Add plan button */}
                <div className="flex shrink-0 items-center justify-center border-b border-slate-200 bg-slate-50 py-4 dark:border-slate-700 dark:bg-slate-800" style={{ width: TRAILING_WIDTH }}>
                  <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }} type="button"
                    onClick={() => handleAddPlan()}
                    className="cursor-pointer rounded-full bg-slate-100 p-2 text-slate-400 transition-colors hover:bg-orange-100 hover:text-[#fa520f] dark:bg-slate-700 dark:text-slate-500 dark:hover:bg-orange-950 dark:hover:text-orange-400"
                    title="Add plan"><FaPlus className="h-3.5 w-3.5" /></motion.button>
                </div>
              </div>

              {/* Body — flex-based for proper DnD alignment */}
              <div className="flex flex-col" style={{ minWidth: 'min-content' }}>

                {/* ── Features section ── */}
                <div className="flex shrink-0 items-center border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Features</span>
                </div>
                <AddRowTrigger label="Add feature" onAdd={handleAddFeature} />
                <SortableContext items={featureKeys} strategy={verticalListSortingStrategy}>
                  {featureKeys.map((featureKey) => {
                    const feature = featureMap[featureKey];
                    if (!feature) return null;
                    return (
                      <Fragment key={featureKey}>
                        <SortableFeatureRow
                          featureKey={featureKey}
                          feature={feature}
                          planKeys={visiblePlanKeys}
                          draft={draft}
                          onToggle={handleToggleFeature}
                          onSetCellValue={handleSetCellValue}
                          onEdit={() => setEditingFeature(featureKey)}
                          onRemove={() => handleRemoveFeature(featureKey)}
                          onToggleRender={handleToggleRender}
                          onRename={(oldKey, newKey) => handleRename('feature', oldKey, newKey)}
                          isCreating={creatingRowKey === featureKey}
                          onCreatingConfirm={handleCreatingConfirm}
                          onCreatingCancel={handleCreatingCancel}
                        />
                        <AddRowTrigger label="Add feature" onAdd={handleAddFeature} />
                      </Fragment>
                    );
                  })}
                </SortableContext>

                {/* ── Usage Limits section ── */}
                <div className="flex shrink-0 items-center border-b border-t border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Usage Limits</span>
                </div>
                <AddRowTrigger label="Add usage limit" onAdd={handleAddUsageLimitInline} />
                <SortableContext items={usageLimitKeys} strategy={verticalListSortingStrategy}>
                  {usageLimitKeys.map((usageKey) => {
                    const usage = usageLimitMap[usageKey];
                    if (!usage) return null;
                    return (
                      <Fragment key={usageKey}>
                        <SortableUsageLimitRow
                          usageKey={usageKey}
                          usage={usage}
                          planKeys={visiblePlanKeys}
                          draft={draft}
                          onToggleRender={handleToggleRender}
                          onEdit={() => setEditingFeature(usageKey)}
                          onRename={(oldKey, newKey) => handleRename('usageLimit', oldKey, newKey)}
                          isCreating={creatingRowKey === usageKey}
                          onCreatingConfirm={handleCreatingConfirm}
                          onCreatingCancel={handleCreatingCancel}
                        />
                        <AddRowTrigger label="Add usage limit" onAdd={handleAddUsageLimitInline} />
                      </Fragment>
                    );
                  })}
                </SortableContext>
              </div>

              {/* No DragOverlay — useSortable transform provides the visual feedback */}
            </DndContext>
          </div>
        </motion.div>
      </div>

      {/* Side panels */}
      <AnimatePresence>
        {editingPlan && editingPlanData && (
          <PlanSidePanel planKey={editingPlan} plan={editingPlanData} currency={resolvedCurrency}
            onClose={() => setEditingPlan(null)}
            onSave={(key, updates) => { applyMutation(updatePlanProps(draft, editingPlan, updates)); if (key !== editingPlan) { applyMutation(renamePlan(draft, editingPlan, key)); } setEditingPlan(null); }}
          />
        )}
        {editingFeature && editingFeatureData && (
          <FeatureSidePanel entityKey={editingFeature} entity={editingFeatureData} isFeature={editingFeatureIsFeature}
            onClose={() => setEditingFeature(null)}
            onSave={handleSaveEntity}
            onConvert={handleConvertEntity}
          />
        )}
        {creatingUsageLimit && (
          <UsageLimitSidePanel featureKeys={featureKeys}
            onClose={() => setCreatingUsageLimit(false)}
            onSave={(data) => {
              const mutated = structuredClone(draft);
              if (!mutated.usageLimits) mutated.usageLimits = {};
              mutated.usageLimits[data.name] = {
                description: '', valueType: 'NUMERIC', defaultValue: data.defaultValue,
                unit: data.unit, type: data.type, linkedFeatures: [data.linkedFeature],
              };
              for (const plan of Object.values(mutated.plans)) {
                if (plan.usageLimits !== null && plan.usageLimits !== undefined) {
                  plan.usageLimits[data.name] = { value: data.defaultValue };
                }
              }
              applyMutation(mutated);
              setCreatingUsageLimit(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
