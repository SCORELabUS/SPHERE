import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FaCheckCircle, FaTimesCircle } from 'react-icons/fa';
import { FaPlus, FaTrash, FaPencil, FaXmark, FaGripVertical } from 'react-icons/fa6';
import { createSwapy, type Swapy } from 'swapy';
import { Pricing, Plan, Feature, UsageLimit } from 'pricing4ts';
import { camelToTitle } from '../pricing-renderer/shared/stringUtils';
import { formatUsageDisplay } from '../pricing-renderer/shared/value-helpers';
import PALETTE from '../pricing-renderer/shared/planPalette';
import {
  parseDraftFromYaml,
  serializeDraftToYaml,
  toggleFeatureValue,
  setCellValue,
  updatePlanProps,
  addPlan,
  removePlan,
  renamePlan,
  ensureSyntaxVersion31,
} from '../../services/pricing2yaml';
import type { PricingDraft } from '../../services/pricing2yaml';

const CURRENCIES: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$',
  CHF: 'CHF', CNY: '¥', SEK: 'kr', NZD: 'NZ$',
};

const FAST_SPRING = { type: 'spring' as const, stiffness: 800, damping: 35 };

const FEATURE_TYPES = ['INFORMATION', 'INTEGRATION', 'DOMAIN', 'AUTOMATION', 'MANAGEMENT', 'GUARANTEE', 'SUPPORT', 'PAYMENT'] as const;
const VALUE_TYPES = ['BOOLEAN', 'TEXT', 'NUMERIC'] as const;
const USAGE_LIMIT_TYPES = ['RENEWABLE', 'NON_RENEWABLE'] as const;

interface VisualPricingEditorProps {
  pricing: Pricing;
  yaml: string;
  onYamlChange: (yaml: string) => void;
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

/* ─── Inline editing for body cells (light bg, fixed width) ─── */
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
      className="rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-center text-sm font-semibold text-slate-900 outline-none ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-slate-800 dark:text-white"
      style={{ width: `${Math.max(draft.length, 3)}ch` }}
    />
  );
}

/* ─── Add-row button between rows ─── */
function AddRowTrigger({ onAddFeature, onAddUsageLimit }: { onAddFeature: () => void; onAddUsageLimit: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  return (
    <tr className="group/addrow h-0">
      <td colSpan={999} className="relative p-0">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center opacity-0 transition-opacity group-hover/addrow:opacity-100 z-10">
          <div className="relative" ref={menuRef}>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }} type="button"
              onClick={() => setShowMenu(!showMenu)}
              className="cursor-pointer flex items-center gap-1 rounded-full border border-dashed border-slate-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm transition-colors hover:border-orange-400 hover:bg-orange-50 hover:text-orange-600 dark:border-slate-600 dark:bg-slate-900 dark:hover:border-orange-500 dark:hover:bg-orange-950 dark:hover:text-orange-400"
            ><FaPlus className="h-2 w-2" /> Add</motion.button>
            <AnimatePresence>
              {showMenu && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className="absolute left-1/2 top-full z-30 mt-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
                >
                  <button type="button" onClick={() => { onAddFeature(); setShowMenu(false); }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                  ><FaPlus className="h-2 w-2 text-indigo-500" /> Feature</button>
                  <button type="button" onClick={() => { onAddUsageLimit(); setShowMenu(false); }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-emerald-50 dark:text-slate-300 dark:hover:bg-emerald-950"
                  ><FaPlus className="h-2 w-2 text-emerald-500" /> Usage limit</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="h-px w-full bg-transparent transition-colors group-hover/addrow:bg-orange-200 dark:group-hover/addrow:bg-orange-800" />
      </td>
    </tr>
  );
}

/* ─── Inline name input row ─── */
function InlineNameInput({
  inputRef, value, onChange, onConfirm, onCancel, placeholder,
}: {
  inputRef: React.Ref<HTMLInputElement>;
  value: string;
  onChange: (v: string) => void; onConfirm: () => void; onCancel: () => void; placeholder: string;
}) {
  return (
    <motion.tr initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
      <td className="border-r border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Name:</span>
      </td>
      <td colSpan={999} className="border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-2">
          <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); }}
            placeholder={placeholder}
            className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} type="button" onClick={onConfirm}
            className="cursor-pointer rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600"
          >Add</motion.button>
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} type="button" onClick={onCancel}
            className="cursor-pointer rounded-md bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300"
          >Cancel</motion.button>
        </div>
      </td>
    </motion.tr>
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
  planKey: string; plan: Plan; currency: string;
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

  // Feature fields
  const f = isFeature ? entity as DraftFeature : null;
  const [valueType, setValueType] = useState(f?.valueType ?? 'BOOLEAN');
  const [defaultValue, setDefaultValue] = useState(String(f?.defaultValue ?? ''));
  const [featureType, setFeatureType] = useState(f?.type ?? 'DOMAIN');
  const [expression, setExpression] = useState(f?.expression ?? '');

  // Usage limit fields
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

        {/* Convert toggle */}
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

/* ════════════════════════════════════════════════════════════════════ */
/* ─── Main Visual Editor ─── */
/* ════════════════════════════════════════════════════════════════════ */
export default function VisualPricingEditor({ pricing, yaml, onYamlChange }: VisualPricingEditorProps) {
  const [draft, setDraft] = useState<PricingDraft>(() => parseDraftFromYaml(ensureSyntaxVersion31(yaml)));
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [hoveredDivider, setHoveredDivider] = useState<number | null>(null);

  // Plan editing
  const [addingPlanAfter, setAddingPlanAfter] = useState<number | null>(null);
  const [newPlanName, setNewPlanName] = useState('');
  const newPlanInputRef = useRef<HTMLInputElement>(null);
  const [editingPlan, setEditingPlan] = useState<string | null>(null);

  // Feature editing
  const [addingFeatureAfter, setAddingFeatureAfter] = useState<number | null>(null);
  const [newFeatureName, setNewFeatureName] = useState('');
  const newFeatureInputRef = useRef<HTMLInputElement>(null);
  const [editingFeature, setEditingFeature] = useState<string | null>(null);

  // Usage limit creation panel
  const [creatingUsageLimit, setCreatingUsageLimit] = useState(false);

  // Reorderable keys (local override for DnD)
  const [planOrder, setPlanOrder] = useState<string[] | null>(null);
  const [featureOrder, setFeatureOrder] = useState<string[] | null>(null);

  const planKeys = useMemo(() => {
    const base = Object.keys(pricing.plans ?? {});
    if (planOrder) return planOrder.filter(k => base.includes(k)).concat(base.filter(k => !planOrder.includes(k)));
    return base;
  }, [pricing.plans, planOrder]);

  const featureKeys = useMemo(() => {
    const base = Object.keys(pricing.features ?? {});
    if (featureOrder) return featureOrder.filter(k => base.includes(k)).concat(base.filter(k => !featureOrder.includes(k)));
    return base;
  }, [pricing.features, featureOrder]);

  const usageLimitKeys = useMemo(() => Object.keys(pricing.usageLimits ?? {}), [pricing.usageLimits]);

  const featureMap = useMemo(() => {
    const m: Record<string, Feature> = {};
    for (const [k, v] of Object.entries(pricing.features ?? {})) m[k] = v;
    return m;
  }, [pricing.features]);

  const usageLimitMap = useMemo(() => {
    const m: Record<string, UsageLimit> = {};
    for (const [k, v] of Object.entries(pricing.usageLimits ?? {})) m[k] = v;
    return m;
  }, [pricing.usageLimits]);

  const usageByFeature = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const [uk, u] of Object.entries(pricing.usageLimits ?? {})) {
      for (const fk of (u as UsageLimit).linkedFeatures ?? []) {
        m[fk] = m[fk] ?? [];
        if (!m[fk].includes(uk)) m[fk].push(uk);
      }
    }
    return m;
  }, [pricing.usageLimits]);

  const resolvedCurrency = pricing.currency in CURRENCIES ? CURRENCIES[pricing.currency] : pricing.currency ?? '';

  /* ── Swapy refs ── */
  const planSwapyRef = useRef<Swapy | null>(null);
  const planSlotRef = useRef<HTMLDivElement>(null);
  const featureSwapyRef = useRef<Swapy | null>(null);
  const featureSlotRef = useRef<HTMLDivElement>(null);

  /* ── Mutations ── */
  const applyMutation = useCallback((mutated: PricingDraft) => {
    setDraft(mutated);
    onYamlChange(serializeDraftToYaml(mutated));
  }, [onYamlChange]);

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

  /* ── Plan operations ── */
  const handleAddPlan = useCallback((afterIdx: number) => {
    setAddingPlanAfter(afterIdx);
    setNewPlanName('');
    setTimeout(() => newPlanInputRef.current?.focus(), 50);
  }, []);

  const confirmAddPlan = useCallback(() => {
    const name = newPlanName.trim();
    if (!name || draft.plans[name]) { setAddingPlanAfter(null); return; }
    const afterKey = addingPlanAfter !== null && addingPlanAfter >= 0 ? planKeys[addingPlanAfter] : undefined;
    applyMutation(addPlan(draft, name, afterKey));
    setAddingPlanAfter(null);
    setNewPlanName('');
  }, [newPlanName, draft, addingPlanAfter, planKeys, applyMutation]);

  const handleRemovePlan = useCallback((planKey: string) => {
    applyMutation(removePlan(draft, planKey));
  }, [draft, applyMutation]);

  /* ── Feature operations ── */
  const handleAddFeature = useCallback((afterIdx: number, type: 'feature' | 'usageLimit' = 'feature') => {
    if (type === 'feature') {
      setAddingFeatureAfter(afterIdx);
      setNewFeatureName('');
      setTimeout(() => newFeatureInputRef.current?.focus(), 50);
    } else {
      // Open usage limit creation side panel
      setCreatingUsageLimit(true);
    }
  }, []);

  const confirmAddFeature = useCallback(() => {
    const name = newFeatureName.trim().replace(/\s+/g, '');
    if (!name || draft.features[name]) { setAddingFeatureAfter(null); return; }
    const newFeatures: Record<string, PricingDraft['features'][string]> = {};
    const keys = Object.keys(draft.features);
    for (let i = 0; i <= keys.length; i++) {
      if (i === addingFeatureAfter! + 1) newFeatures[name] = { valueType: 'BOOLEAN', defaultValue: false, type: 'DOMAIN' };
      if (i < keys.length) newFeatures[keys[i]] = draft.features[keys[i]];
    }
    const mutated = { ...draft, features: newFeatures };
    for (const plan of Object.values(mutated.plans)) {
      if (plan.features !== null && plan.features !== undefined) {
        plan.features[name] = { value: false };
      }
    }
    applyMutation(mutated);
    setAddingFeatureAfter(null);
    setNewFeatureName('');
  }, [newFeatureName, draft, addingFeatureAfter, applyMutation]);

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
      // Rename key if name changed
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

  /* ── Swapy setup ── */
  useEffect(() => {
    if (!planSlotRef.current) return;
    if (planSwapyRef.current) planSwapyRef.current.destroy();
    planSwapyRef.current = createSwapy(planSlotRef.current, {
      animation: 'spring', continuousMode: false, manualSwap: false, swapMode: 'hover', autoScrollOnDrag: false,
    });
    planSwapyRef.current.onSwapEnd((event) => {
      const map = event.data.map;
      const newOrder: string[] = [];
      map.forEach((itemId) => { if (itemId) newOrder.push(itemId); });
      if (newOrder.length === planKeys.length) {
        setPlanOrder(newOrder);
        // Persist to draft
        const reordered: Record<string, PricingDraft['plans'][string]> = {};
        for (const k of newOrder) reordered[k] = draft.plans[k];
        applyMutation({ ...draft, plans: reordered });
      }
    });
    return () => { planSwapyRef.current?.destroy(); planSwapyRef.current = null; };
  }, [planKeys.length, draft.plans]);

  useEffect(() => {
    if (!featureSlotRef.current) return;
    if (featureSwapyRef.current) featureSwapyRef.current.destroy();
    featureSwapyRef.current = createSwapy(featureSlotRef.current, {
      animation: 'spring', continuousMode: false, manualSwap: false, swapMode: 'hover', autoScrollOnDrag: false,
    });
    featureSwapyRef.current.onSwapEnd((event) => {
      const map = event.data.map;
      const newOrder: string[] = [];
      map.forEach((itemId) => { if (itemId) newOrder.push(itemId); });
      if (newOrder.length === featureKeys.length) {
        setFeatureOrder(newOrder);
        const reordered: Record<string, PricingDraft['features'][string]> = {};
        for (const k of newOrder) reordered[k] = draft.features[k];
        applyMutation({ ...draft, features: reordered });
      }
    });
    return () => { featureSwapyRef.current?.destroy(); featureSwapyRef.current = null; };
  }, [featureKeys.length, draft.features]);

  useEffect(() => {
    const p = parseDraftFromYaml(ensureSyntaxVersion31(yaml));
    setDraft(p);
  }, [yaml]);

  const editingPlanData = editingPlan ? (pricing.plans?.[editingPlan] ?? {}) as Plan : null;
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
          <span>{planKeys.length} plans</span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span>{featureKeys.length} features</span>
          {usageLimitKeys.length > 0 && <><span className="text-slate-300 dark:text-slate-600">|</span><span>{usageLimitKeys.length} limits</span></>}
        </div>
      </motion.div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }} className="mx-auto max-w-7xl">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="w-[200px] min-w-[160px] border-b border-r border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800" />
                  {/* Draggable plan columns */}
                  <div ref={planSlotRef} className="contents">
                    {planKeys.map((planKey, index) => {
                      const plan = (pricing.plans?.[planKey] ?? {}) as Plan;
                      if (plan.private) return null;
                      const [a, b] = PALETTE[index % PALETTE.length];

                      return (
                        <div key={planKey} data-swapy-slot={planKey} className="contents">
                          <div data-swapy-item={planKey} className="contents">
                            <th
                              className="group relative border-b border-r border-slate-200 px-2 py-0 dark:border-slate-700"
                              style={{ background: 'transparent' }}
                              onMouseEnter={() => setHoveredCol(index)}
                              onMouseLeave={() => setHoveredCol(null)}
                            >
                              <div className="absolute inset-0 rounded-t-lg" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
                              <div className="relative flex flex-col items-center py-4 text-center">
                                {/* Drag handle */}
                                <div className="absolute left-1 top-2 cursor-grab text-white/40 hover:text-white/80 active:cursor-grabbing" data-swapy-drag-handle={planKey}>
                                  <FaGripVertical className="h-3 w-3" />
                                </div>
                                {/* Plan name */}
                                <div className="relative">
                                  <span className="cursor-pointer rounded px-2 py-0.5 text-white transition-colors hover:bg-white/20">
                                    {plan.name?.toUpperCase() ?? planKey}
                                  </span>
                                </div>
                                {/* Price */}
                                <div className="mt-1">
                                  {plan.price === 0 ? (
                                    <span className="text-base font-bold text-white/90">FREE</span>
                                  ) : (
                                    <span className="flex items-center text-base font-bold text-white">
                                      <HeaderInlineEdit value={String(plan.price)} onSave={(v) => handlePlanPriceChange(planKey, v)} className="!text-base !font-bold !text-white" numeric selectOnFocus />
                                      <span className="ml-0.5 text-sm font-normal text-white/70">{resolvedCurrency}</span>
                                    </span>
                                  )}
                                </div>
                                {plan.unit && <div className="mt-0.5"><HeaderInlineEdit value={plan.unit} onSave={(v) => handlePlanUnitChange(planKey, v)} className="!text-xs !text-white/70" /></div>}
                              </div>
                              {/* Actions */}
                              {hoveredCol === index && (
                                <div className="absolute right-1 top-1 z-10 flex gap-0.5">
                                  <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} type="button"
                                    onClick={() => setEditingPlan(planKey)}
                                    className="cursor-pointer rounded-md bg-white/20 p-1 text-white/70 backdrop-blur-sm transition-colors hover:bg-white/30 hover:text-white"
                                    title="Edit plan details"><FaPencil className="h-2.5 w-2.5" /></motion.button>
                                  {planKeys.length > 1 && (
                                    <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} type="button"
                                      onClick={() => handleRemovePlan(planKey)}
                                      className="cursor-pointer rounded-md bg-red-500/20 p-1 text-red-200 backdrop-blur-sm transition-colors hover:bg-red-500/40 hover:text-red-100"
                                      title="Remove plan"><FaTrash className="h-2.5 w-2.5" /></motion.button>
                                  )}
                                </div>
                              )}
                              {/* Divider hover zone */}
                              {index < planKeys.length - 1 && (
                                <div className="absolute right-0 top-0 z-20 h-full w-3 cursor-col-resize"
                                  onMouseEnter={() => setHoveredDivider(index)} onMouseLeave={() => setHoveredDivider(null)}
                                  onClick={() => handleAddPlan(index)}
                                >
                                  <AnimatePresence>
                                    {hoveredDivider === index && (
                                      <motion.div initial={{ opacity: 0, scaleY: 0.5 }} animate={{ opacity: 1, scaleY: 1 }} exit={{ opacity: 0, scaleY: 0.5 }} transition={FAST_SPRING}
                                        className="absolute inset-y-0 -left-2 flex items-center justify-center"
                                      >
                                        <div className="absolute inset-y-0 w-1 rounded-full bg-[#fa520f]" />
                                        <div className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#fa520f] text-white shadow-lg"><FaPlus className="h-2.5 w-2.5" /></div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              )}
                            </th>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Add plan at end */}
                  <th className="w-[60px] border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex h-full items-center justify-center py-4">
                      <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }} type="button"
                        onClick={() => handleAddPlan(planKeys.length - 1)}
                        className="cursor-pointer rounded-full bg-slate-100 p-2 text-slate-400 transition-colors hover:bg-orange-100 hover:text-[#fa520f] dark:bg-slate-700 dark:text-slate-500 dark:hover:bg-orange-950 dark:hover:text-orange-400"
                        title="Add plan"><FaPlus className="h-3.5 w-3.5" /></motion.button>
                    </div>
                  </th>
                </tr>
              </thead>

              <tbody>
                {/* Add-row trigger BEFORE first feature */}
                <AddRowTrigger
                  onAddFeature={() => handleAddFeature(-1)}
                  onAddUsageLimit={() => handleAddFeature(-1, 'usageLimit')}
                />

                {/* Swapy container for feature rows */}
                <div ref={featureSlotRef} className="contents">
                {featureKeys.map((featureKey, fIdx) => {
                    const feature = featureMap[featureKey];
                    if (!feature || feature.render === 'disabled') return null;
                    const linkedUsageKeys = usageByFeature[featureKey] ?? [];
                    const showInlineUsage = feature.render !== 'enabled' && linkedUsageKeys.length === 1 && (usageLimitMap[linkedUsageKeys[0]]?.render ?? 'auto') === 'auto';

                    return (
                      <div key={featureKey} data-swapy-slot={featureKey} className="contents">
                        <div data-swapy-item={featureKey} className="contents">
                          <motion.tr layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}
                            transition={{ delay: 0.02 * fIdx, duration: 0.25 }}
                            className="group border-b border-slate-100 dark:border-slate-800"
                          >
                            <td className="relative border-r border-slate-200 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                              <div className="flex items-center gap-1.5">
                                <div className="cursor-grab text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-500 active:cursor-grabbing" data-swapy-drag-handle={featureKey}>
                                  <FaGripVertical className="h-3 w-3" />
                                </div>
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                  {camelToTitle(feature.name ?? featureKey)}
                                </span>
                                {showInlineUsage && linkedUsageKeys[0] && (
                                  <span className="text-xs text-slate-400 dark:text-slate-500">({usageLimitMap[linkedUsageKeys[0]]?.unit ?? ''})</span>
                                )}
                              </div>
                              {/* Edit / delete buttons */}
                              <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                <button type="button" onClick={() => setEditingFeature(featureKey)}
                                  className="cursor-pointer rounded p-0.5 text-slate-400 transition-colors hover:text-indigo-500" title="Edit">
                                  <FaPencil className="h-2.5 w-2.5" />
                                </button>
                                <button type="button" onClick={() => handleRemoveFeature(featureKey)}
                                  className="cursor-pointer rounded p-0.5 text-slate-400 transition-colors hover:text-red-500" title="Remove">
                                  <FaTrash className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            </td>

                            {planKeys.map((planKey, pIdx) => {
                              const plan = (pricing.plans?.[planKey] ?? {}) as Plan;
                              if (plan.private) return null;
                              const featureValue = (plan.features as Record<string, { value: unknown }> | undefined)?.[featureKey]?.value;
                              const globalDefault = feature.defaultValue;
                              const effectiveValue = featureValue ?? globalDefault;
                              const toneClass = pIdx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/50';

                              if (typeof effectiveValue === 'boolean') {
                                return (
                                  <td key={planKey} className={`border-r border-slate-100 px-2 py-3 text-center align-middle dark:border-slate-800 ${toneClass}`}>
                                    <motion.div className="flex cursor-pointer items-center justify-center"
                                      onClick={() => handleToggleFeature(planKey, featureKey)}
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
                                  </td>
                                );
                              }

                              if (showInlineUsage && linkedUsageKeys[0]) {
                                const usage = usageLimitMap[linkedUsageKeys[0]];
                                const usageValue = (plan.usageLimits as Record<string, { value: unknown }> | undefined)?.[linkedUsageKeys[0]]?.value;
                                const effectiveUsage = usageValue ?? usage?.defaultValue;
                                if (effectiveUsage !== undefined && effectiveUsage !== null && effectiveUsage !== 0 && effectiveUsage !== '') {
                                  return (
                                    <td key={planKey} className={`border-r border-slate-100 px-2 py-3 text-center align-middle dark:border-slate-800 ${toneClass}`}>
                                      <span className="inline-flex items-center justify-center rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-bold text-white">
                                        {formatUsageDisplay(effectiveUsage, usage)}
                                      </span>
                                    </td>
                                  );
                                }
                              }

                              const strVal = effectiveValue !== undefined && effectiveValue !== null && effectiveValue !== '' ? String(effectiveValue) : '';
                              const isNumeric = typeof effectiveValue === 'number' || feature.valueType === 'NUMERIC';

                              return (
                                <td key={planKey} className={`border-r border-slate-100 px-2 py-3 text-center align-middle dark:border-slate-800 ${toneClass}`}>
                                  {strVal ? (
                                    <CellInlineEdit value={strVal} numeric={isNumeric}
                                      onSave={(v) => { const p = isNumeric ? (v === '' ? 0 : Number(v)) : v; handleSetCellValue(planKey, 'feature', featureKey, Number.isNaN(p) ? v : p); }}
                                      className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300"
                                    />
                                  ) : (
                                    <FaTimesCircle className="mx-auto text-slate-300 dark:text-slate-600" />
                                  )}
                                </td>
                              );
                            })}
                            <td className="bg-slate-50 dark:bg-slate-800" />
                          </motion.tr>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add-row trigger after last feature */}
                <AddRowTrigger onAddFeature={() => handleAddFeature(featureKeys.length - 1)} onAddUsageLimit={() => handleAddFeature(featureKeys.length - 1, 'usageLimit')} />

                {/* Usage limit rows (separate, non-embedded) */}
                <AnimatePresence mode="popLayout">
                  {usageLimitKeys.filter(uk => {
                    const u = usageLimitMap[uk];
                    if (!u) return false;
                    if (u.render === 'disabled') return false;
                    if (u.render === 'enabled') return true;
                    const linked = u.linkedFeatures ?? [];
                    if (linked.length > 1) return true;
                    return false;
                  }).map((usageKey, uIdx) => {
                    const usage = usageLimitMap[usageKey];
                    if (!usage) return null;

                    return (
                      <motion.tr key={`usage-${usageKey}`} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}
                        transition={{ delay: 0.02 * uIdx, duration: 0.25 }}
                        className="group border-b border-slate-100 dark:border-slate-800"
                      >
                        <td className="relative border-r border-slate-200 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{camelToTitle(usage.name ?? usageKey)}</span>
                            <span className="text-xs text-slate-400 dark:text-slate-500">({usage.unit})</span>
                          </div>
                          <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button type="button" onClick={() => setEditingFeature(usageKey)}
                              className="cursor-pointer rounded p-0.5 text-slate-400 transition-colors hover:text-indigo-500" title="Edit">
                              <FaPencil className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </td>
                        {planKeys.map((planKey, pIdx) => {
                          const plan = (pricing.plans?.[planKey] ?? {}) as Plan;
                          if (plan.private) return null;
                          const usageValue = (plan.usageLimits as Record<string, { value: unknown }> | undefined)?.[usageKey]?.value;
                          const effectiveValue = usageValue ?? usage.defaultValue;
                          const toneClass = pIdx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/50';
                          const strVal = effectiveValue !== undefined && effectiveValue !== null && effectiveValue !== 0 ? String(effectiveValue) : '';
                          return (
                            <td key={planKey} className={`border-r border-slate-100 px-2 py-3 text-center align-middle dark:border-slate-800 ${toneClass}`}>
                              {strVal ? (
                                <span className="inline-flex items-center justify-center rounded-full bg-indigo-500 px-4 py-1.5 text-sm font-bold text-white">
                                  {formatUsageDisplay(effectiveValue, usage)}
                                </span>
                              ) : (
                                <FaTimesCircle className="mx-auto text-slate-300 dark:text-slate-600" />
                              )}
                            </td>
                          );
                        })}
                        <td className="bg-slate-50 dark:bg-slate-800" />
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>

                {/* Inline forms */}
                <AnimatePresence>
                  {addingPlanAfter !== null && (
                    <InlineNameInput inputRef={newPlanInputRef} value={newPlanName} onChange={setNewPlanName}
                      onConfirm={confirmAddPlan} onCancel={() => setAddingPlanAfter(null)} placeholder="Plan name..." />
                  )}
                  {addingFeatureAfter !== null && (
                    <InlineNameInput inputRef={newFeatureInputRef} value={newFeatureName} onChange={setNewFeatureName}
                      onConfirm={confirmAddFeature} onCancel={() => setAddingFeatureAfter(null)} placeholder="Feature key (camelCase)..." />
                  )}
                </AnimatePresence>
              </tbody>
            </table>
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

type DraftFeature = PricingDraft['features'][string];
type DraftUsageLimit = NonNullable<PricingDraft['usageLimits']>[string];

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
