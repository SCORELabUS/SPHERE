import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FaFloppyDisk, FaPlus } from 'react-icons/fa6';
import {
  DndContext, closestCenter, rectIntersection, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import {
  parseDraftFromYaml, toggleFeatureValue, setCellValue, updatePlanProps, updateRenderMode, updateField,
  addPlan, removePlan, removeUsageLimit, ensureSyntaxVersion31,
  addAddOn, removeAddOn, renameAddOn, updateAddOnProps, toggleAddOnAvailableFor,
} from '../../services/pricing2yaml';
import type { PricingDraft, DraftPlan, DraftFeature, DraftUsageLimit, DraftAddOn } from '../../services/pricing2yaml';

import { SortablePlanHeader } from './components/SortablePlanHeader';
import { SortableFeatureRow } from './components/SortableFeatureRow';
import { SortableUsageLimitRow } from './components/SortableUsageLimitRow';
import { AddOnCard } from './components/AddOnCard';
import { CellInlineEdit } from './components/CellInlineEdit';
import { AddRowTrigger } from './components/AddRowTrigger';
import { PlanSidePanel } from './components/PlanSidePanel';
import { FeatureSidePanel } from './components/FeatureSidePanel';
import { UsageLimitSidePanel } from './components/UsageLimitSidePanel';
import { AddOnSidePanel } from './components/AddOnSidePanel';
import { CURRENCIES, LABEL_WIDTH, TRAILING_WIDTH } from './utils/constants';
import { getNextName } from './utils/names';

interface VisualPricingEditorProps {
  yaml: string;
  isDirty: boolean;
  onDraftChange: (draft: PricingDraft) => void;
  onSave: () => void;
}

export default function VisualPricingEditor({ yaml, isDirty, onDraftChange, onSave }: VisualPricingEditorProps) {
  const [draft, setDraft] = useState<PricingDraft>(() => parseDraftFromYaml(ensureSyntaxVersion31(yaml)));
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [editingFeature, setEditingFeature] = useState<string | null>(null);
  const [editingAddOn, setEditingAddOn] = useState<string | null>(null);
  const [creatingRowKey, setCreatingRowKey] = useState<string | null>(null);
  const [creatingUsageLimit, setCreatingUsageLimit] = useState(false);

  const [planOrder, setPlanOrder] = useState<string[] | null>(null);
  const [featureOrder, setFeatureOrder] = useState<string[] | null>(null);
  const [usageLimitOrder, setUsageLimitOrder] = useState<string[] | null>(null);
  const [addOnOrder, setAddOnOrder] = useState<string[] | null>(null);
  const [activeAddOnId, setActiveAddOnId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor),
  );

  /* ── Derived data ── */
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

  const addOnKeys = useMemo(() => {
    const base = Object.keys(draft.addOns ?? {});
    if (addOnOrder) return addOnOrder.filter(k => base.includes(k)).concat(base.filter(k => !addOnOrder.includes(k)));
    return base;
  }, [draft.addOns, addOnOrder]);

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

  const planIndexMap = useMemo(() => {
    const m: Record<string, number> = {};
    planKeys.forEach((pk, i) => { m[pk] = i; });
    return m;
  }, [planKeys]);

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

  const handleSaasNameChange = useCallback((name: string) => {
    if (name && name !== draft.saasName) applyMutation(updateField(draft, 'saasName', name));
  }, [draft, applyMutation]);

  const handleCurrencyChange = useCallback((currency: string) => {
    const v = currency.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    if (v !== draft.currency) applyMutation(updateField(draft, 'currency', v));
  }, [draft, applyMutation]);

  const handleToggleRender = useCallback((entityType: 'feature' | 'usageLimit', key: string) => {
    const entity = entityType === 'feature' ? draft.features[key] : draft.usageLimits?.[key];
    if (!entity) return;
    const current = entity.render ?? 'auto';
    const next = current === 'disabled' ? 'enabled' : current === 'enabled' ? 'auto' : 'disabled';
    applyMutation(updateRenderMode(draft, entityType, key, next));
  }, [draft, applyMutation]);

  const handleRename = useCallback((entityType: 'feature' | 'usageLimit' | 'plan', oldKey: string, newKey: string) => {
    if (oldKey === newKey || !newKey) return;
    const mutated = structuredClone(draft);
    if (entityType === 'feature') {
      if (mutated.features[newKey]) return;
      const newFeatures: Record<string, DraftFeature> = {};
      for (const k of Object.keys(mutated.features)) newFeatures[k === oldKey ? newKey : k] = mutated.features[k];
      mutated.features = newFeatures;
      for (const plan of Object.values(mutated.plans)) {
        if (plan.features?.[oldKey]) { plan.features[newKey] = plan.features[oldKey]; delete plan.features[oldKey]; }
      }
      if (mutated.usageLimits) {
        for (const ul of Object.values(mutated.usageLimits)) {
          if (ul.linkedFeatures) ul.linkedFeatures = ul.linkedFeatures.map(f => f === oldKey ? newKey : f);
        }
      }
    } else if (entityType === 'usageLimit') {
      if (!mutated.usageLimits) return;
      if (mutated.usageLimits[newKey]) return;
      const newUl: Record<string, DraftUsageLimit> = {};
      for (const k of Object.keys(mutated.usageLimits)) newUl[k === oldKey ? newKey : k] = mutated.usageLimits[k];
      mutated.usageLimits = newUl;
      for (const plan of Object.values(mutated.plans)) {
        if (plan.usageLimits?.[oldKey]) { plan.usageLimits[newKey] = plan.usageLimits[oldKey]; delete plan.usageLimits[oldKey]; }
      }
    } else {
      if (mutated.plans[newKey]) return;
      const newPlans: Record<string, DraftPlan> = {};
      for (const k of Object.keys(mutated.plans)) newPlans[k === oldKey ? newKey : k] = mutated.plans[k];
      mutated.plans = newPlans;
      if (mutated.addOns) {
        for (const ao of Object.values(mutated.addOns)) {
          if (ao.availableFor) ao.availableFor = ao.availableFor.map(p => p === oldKey ? newKey : p);
        }
      }
    }
    applyMutation(mutated);
  }, [draft, applyMutation]);

  /* ── Plan operations ── */
  const handleAddPlan = useCallback(() => {
    const name = getNextName('plan', Object.keys(draft.plans));
    applyMutation(addPlan(draft, name));
  }, [draft, applyMutation]);

  const handleRemovePlan = useCallback((planKey: string) => {
    applyMutation(removePlan(draft, planKey));
  }, [draft, applyMutation]);

  /* ── Feature / Usage limit operations ── */
  const handleAddFeature = useCallback((afterIndex?: number) => {
    const name = getNextName('feature', Object.keys(draft.features));
    const mutated = structuredClone(draft);
    const newFeatures: Record<string, DraftFeature> = {};
    const keys = Object.keys(mutated.features);
    const insertAt = afterIndex !== undefined ? afterIndex + 1 : keys.length;
    for (let i = 0; i <= keys.length; i++) {
      if (i === insertAt) newFeatures[name] = { valueType: 'BOOLEAN', defaultValue: false, type: 'DOMAIN' };
      if (i < keys.length) newFeatures[keys[i]] = mutated.features[keys[i]];
    }
    mutated.features = newFeatures;
    for (const plan of Object.values(mutated.plans)) {
      if (plan.features !== null && plan.features !== undefined) plan.features[name] = { value: false };
    }
    applyMutation(mutated);
    setCreatingRowKey(name);
  }, [draft, applyMutation]);

  const handleAddUsageLimitInline = useCallback((afterIndex?: number) => {
    const name = getNextName('usageLimit', Object.keys(draft.usageLimits ?? {}));
    const mutated = structuredClone(draft);
    if (!mutated.usageLimits) mutated.usageLimits = {};
    const newUl: Record<string, DraftUsageLimit> = {};
    const keys = Object.keys(mutated.usageLimits);
    const insertAt = afterIndex !== undefined ? afterIndex + 1 : keys.length;
    for (let i = 0; i <= keys.length; i++) {
      if (i === insertAt) newUl[name] = { description: '', valueType: 'NUMERIC', defaultValue: 0, unit: 'unit', type: 'RENEWABLE', linkedFeatures: [] };
      if (i < keys.length) newUl[keys[i]] = mutated.usageLimits[keys[i]];
    }
    mutated.usageLimits = newUl;
    for (const plan of Object.values(mutated.plans)) {
      if (plan.usageLimits !== null && plan.usageLimits !== undefined) plan.usageLimits[name] = { value: 0 };
    }
    applyMutation(mutated);
    setCreatingRowKey(name);
  }, [draft, applyMutation]);

  const handleCreatingConfirm = useCallback((newKey: string) => {
    if (!creatingRowKey) return;
    if (newKey !== creatingRowKey && !draft.features[newKey] && !(draft.usageLimits ?? {})[newKey]) {
      const isFeature = creatingRowKey in draft.features;
      const mutated = structuredClone(draft);
      if (isFeature) {
        const nf: Record<string, DraftFeature> = {};
        for (const k of Object.keys(mutated.features)) nf[k === creatingRowKey ? newKey : k] = mutated.features[k];
        mutated.features = nf;
        for (const plan of Object.values(mutated.plans)) {
          if (plan.features?.[creatingRowKey]) { plan.features[newKey] = plan.features[creatingRowKey]; delete plan.features[creatingRowKey]; }
        }
      } else {
        if (!mutated.usageLimits) mutated.usageLimits = {};
        const nul: Record<string, DraftUsageLimit> = {};
        for (const k of Object.keys(mutated.usageLimits)) nul[k === creatingRowKey ? newKey : k] = mutated.usageLimits[k];
        mutated.usageLimits = nul;
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
      for (const plan of Object.values(mutated.plans)) { if (plan.features) delete plan.features[creatingRowKey]; }
    } else {
      if (mutated.usageLimits) delete mutated.usageLimits[creatingRowKey];
      for (const plan of Object.values(mutated.plans)) { if (plan.usageLimits) delete plan.usageLimits[creatingRowKey]; }
    }
    applyMutation(mutated);
    setCreatingRowKey(null);
  }, [creatingRowKey, draft, applyMutation]);

  const handleRemoveFeature = useCallback((featureKey: string) => {
    const mutated = structuredClone(draft);
    delete mutated.features[featureKey];
    for (const plan of Object.values(mutated.plans)) { if (plan.features) delete plan.features[featureKey]; }
    if (mutated.usageLimits) {
      for (const ul of Object.values(mutated.usageLimits)) { if (ul.linkedFeatures) ul.linkedFeatures = ul.linkedFeatures.filter(f => f !== featureKey); }
    }
    applyMutation(mutated);
  }, [draft, applyMutation]);

  const handleRemoveUsageLimit = useCallback((limitKey: string) => {
    applyMutation(removeUsageLimit(draft, limitKey));
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

  /* ── Add-on operations ── */
  const handleAddAddOn = useCallback(() => {
    const name = getNextName('addOn', Object.keys(draft.addOns ?? {}));
    applyMutation(addAddOn(draft, name));
    setCreatingRowKey(name);
  }, [draft, applyMutation]);

  const handleRemoveAddOn = useCallback((addOnKey: string) => {
    applyMutation(removeAddOn(draft, addOnKey));
  }, [draft, applyMutation]);

  const handleAddOnRename = useCallback((oldKey: string, newKey: string) => {
    if (oldKey === newKey || !newKey) return;
    applyMutation(renameAddOn(draft, oldKey, newKey));
  }, [draft, applyMutation]);

  const handleToggleAddOnAvailableFor = useCallback((addOnKey: string, planKey: string) => {
    applyMutation(toggleAddOnAvailableFor(draft, addOnKey, planKey));
  }, [draft, applyMutation]);

  const handleUpdateAddOn = useCallback((addOnKey: string, updates: Partial<DraftAddOn>) => {
    applyMutation(updateAddOnProps(draft, addOnKey, updates));
  }, [draft, applyMutation]);

  /* ── DnD ── */
  const handleDragStart = useCallback((event: { active: { id: string | number } }) => {
    const id = String(event.active.id);
    if (addOnKeys.includes(id)) setActiveAddOnId(id);
  }, [addOnKeys]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    if (addOnKeys.includes(activeId) && addOnKeys.includes(overId)) {
      const oldIndex = addOnKeys.indexOf(activeId);
      const newIndex = addOnKeys.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const newOrder = arrayMove(addOnKeys, oldIndex, newIndex);
      setAddOnOrder(newOrder);
      const reordered: Record<string, DraftAddOn> = {};
      for (const k of newOrder) reordered[k] = draft.addOns![k];
      applyMutation({ ...draft, addOns: reordered });
    }
  }, [addOnKeys, draft, applyMutation]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveAddOnId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (planKeys.includes(activeId) && planKeys.includes(overId)) {
      const newOrder = arrayMove(planKeys, planKeys.indexOf(activeId), planKeys.indexOf(overId));
      setPlanOrder(newOrder);
      const reordered: Record<string, DraftPlan> = {};
      for (const k of newOrder) reordered[k] = draft.plans[k];
      applyMutation({ ...draft, plans: reordered });
      return;
    }
    if (featureKeys.includes(activeId) && featureKeys.includes(overId)) {
      const newOrder = arrayMove(featureKeys, featureKeys.indexOf(activeId), featureKeys.indexOf(overId));
      setFeatureOrder(newOrder);
      const reordered: Record<string, DraftFeature> = {};
      for (const k of newOrder) reordered[k] = draft.features[k];
      applyMutation({ ...draft, features: reordered });
      return;
    }
    if (usageLimitKeys.includes(activeId) && usageLimitKeys.includes(overId)) {
      const newOrder = arrayMove(usageLimitKeys, usageLimitKeys.indexOf(activeId), usageLimitKeys.indexOf(overId));
      setUsageLimitOrder(newOrder);
      const reordered: Record<string, DraftUsageLimit> = {};
      for (const k of newOrder) reordered[k] = draft.usageLimits![k];
      applyMutation({ ...draft, usageLimits: reordered });
      return;
    }
    if (addOnKeys.includes(activeId) && addOnKeys.includes(overId)) {
      const newOrder = arrayMove(addOnKeys, addOnKeys.indexOf(activeId), addOnKeys.indexOf(overId));
      setAddOnOrder(newOrder);
      const reordered: Record<string, DraftAddOn> = {};
      for (const k of newOrder) reordered[k] = draft.addOns![k];
      applyMutation({ ...draft, addOns: reordered });
    }
  }, [planKeys, featureKeys, usageLimitKeys, addOnKeys, draft, applyMutation]);

  /* ── Keyboard shortcut ── */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (isDirty) onSave(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, onSave]);

  const editingPlanData = editingPlan ? draft.plans[editingPlan] ?? null : null;
  const editingFeatureData = editingFeature ? (draft.features[editingFeature] ?? draft.usageLimits?.[editingFeature]) : null;
  const editingFeatureIsFeature = editingFeature ? editingFeature in draft.features : false;

  /* ── Render ── */
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
      {/* Header bar */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }}
        className="flex flex-col gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-700 dark:bg-slate-900/80"
      >
        <div className="flex min-w-0 items-center gap-3">
          <CellInlineEdit value={draft.saasName} onSave={handleSaasNameChange}
            className="text-lg! font-bold! tracking-tight! text-slate-900! dark:text-white!" />
          <CellInlineEdit value={draft.currency ?? ''} onSave={handleCurrencyChange}
            className="rounded-full! bg-slate-100! px-2.5! py-0.5! text-xs! font-medium! text-slate-600! dark:bg-slate-800! dark:text-slate-400!" />
        </div>
        <div className="flex w-full min-w-0 items-center justify-between gap-3 text-[11px] text-slate-500 sm:w-auto sm:justify-end sm:text-xs dark:text-slate-400">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span>{visiblePlanKeys.length} plans</span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span>{featureKeys.length} features</span>
          {usageLimitKeys.length > 0 && <><span className="text-slate-300 dark:text-slate-600">|</span><span>{usageLimitKeys.length} limits</span></>}
          {addOnKeys.length > 0 && <><span className="text-slate-300 dark:text-slate-600">|</span><span>{addOnKeys.length} add-ons</span></>}
          </div>
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            type="button" onClick={onSave} disabled={!isDirty}
            className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:ml-3 ${
              isDirty ? 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700' : 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600'
            }`} title="Save changes (Ctrl+S)"
          ><FaFloppyDisk className="h-3 w-3" /> Save</motion.button>
        </div>
      </motion.div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }} className="mx-auto max-w-7xl">
          <div className="overflow-x-auto overflow-y-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              {/* Header row */}
              <div className="sticky top-0 z-20 flex shrink-0 border-b border-slate-200 dark:border-slate-700" style={{ minWidth: 'min-content' }}>
                <div className="shrink-0 border-r border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800" style={{ width: LABEL_WIDTH }} />
                <SortableContext items={visiblePlanKeys} strategy={horizontalListSortingStrategy}>
                  {visiblePlanKeys.map((planKey, index) => (
                    <SortablePlanHeader key={planKey} planKey={planKey} index={index} plan={draft.plans[planKey]}
                      currency={resolvedCurrency} isHovered={hoveredCol === index}
                      onHover={(h) => setHoveredCol(h ? index : null)}
                      onEdit={() => setEditingPlan(planKey)} onRemove={() => handleRemovePlan(planKey)}
                      onPriceChange={(v) => handlePlanPriceChange(planKey, v)}
                      onUnitChange={(v) => handlePlanUnitChange(planKey, v)}
                      onRename={(ok, nk) => handleRename('plan', ok, nk)}
                      canRemove={visiblePlanKeys.length > 1} />
                  ))}
                </SortableContext>
                <div className="flex shrink-0 items-center justify-center border-b border-slate-200 bg-slate-50 py-4 dark:border-slate-700 dark:bg-slate-800" style={{ width: TRAILING_WIDTH }}>
                  <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }} type="button" onClick={handleAddPlan}
                    className="cursor-pointer rounded-full bg-slate-100 p-2 text-slate-400 transition-colors hover:bg-orange-100 hover:text-[#fa520f] dark:bg-slate-700 dark:text-slate-500 dark:hover:bg-orange-950 dark:hover:text-orange-400"
                    title="Add plan"><FaPlus className="h-3.5 w-3.5" /></motion.button>
                </div>
              </div>

              {/* Body */}
              <div className="flex flex-col" style={{ minWidth: 'min-content' }}>
                {/* Features section */}
                <div className="flex shrink-0 items-center border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Features</span>
                </div>
                <AddRowTrigger label="Add feature" onAdd={() => handleAddFeature(-1)} />
                <SortableContext items={featureKeys} strategy={verticalListSortingStrategy}>
                  {featureKeys.map((featureKey, fIdx) => {
                    const feature = featureMap[featureKey];
                    if (!feature) return null;
                    return (
                      <Fragment key={featureKey}>
                        <SortableFeatureRow featureKey={featureKey} feature={feature} planKeys={visiblePlanKeys} draft={draft}
                          onToggle={handleToggleFeature} onSetCellValue={handleSetCellValue}
                          onEdit={() => setEditingFeature(featureKey)} onRemove={() => handleRemoveFeature(featureKey)}
                          onToggleRender={handleToggleRender} onRename={(ok, nk) => handleRename('feature', ok, nk)}
                          isCreating={creatingRowKey === featureKey} onCreatingConfirm={handleCreatingConfirm} onCreatingCancel={handleCreatingCancel} />
                        <AddRowTrigger label="Add feature" onAdd={() => handleAddFeature(fIdx)} />
                      </Fragment>
                    );
                  })}
                </SortableContext>

                {/* Usage Limits section */}
                <div className="flex shrink-0 items-center border-b border-t border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Usage Limits</span>
                </div>
                <AddRowTrigger label="Add usage limit" onAdd={() => handleAddUsageLimitInline(-1)} />
                <SortableContext items={usageLimitKeys} strategy={verticalListSortingStrategy}>
                  {usageLimitKeys.map((usageKey, uIdx) => {
                    const usage = usageLimitMap[usageKey];
                    if (!usage) return null;
                    return (
                      <Fragment key={usageKey}>
                        <SortableUsageLimitRow usageKey={usageKey} usage={usage} planKeys={visiblePlanKeys} draft={draft}
                          onToggleRender={handleToggleRender} onEdit={() => setEditingFeature(usageKey)}
                          onRemove={() => handleRemoveUsageLimit(usageKey)}
                          onRename={(ok, nk) => handleRename('usageLimit', ok, nk)}
                          onSetCellValue={handleSetCellValue}
                          isCreating={creatingRowKey === usageKey} onCreatingConfirm={handleCreatingConfirm} onCreatingCancel={handleCreatingCancel} />
                        <AddRowTrigger label="Add usage limit" onAdd={() => handleAddUsageLimitInline(uIdx)} />
                      </Fragment>
                    );
                  })}
                </SortableContext>
              </div>
            </DndContext>
          </div>
        </motion.div>

        {/* Add-ons grid (separate from table) */}
        {addOnKeys.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }} className="mx-auto mt-4 max-w-7xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Add-Ons</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{addOnKeys.length}</span>
              </div>
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} type="button" onClick={handleAddAddOn}
                className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-indigo-500 dark:hover:text-indigo-400">
                <FaPlus className="h-3 w-3" /> Add add-on
              </motion.button>
            </div>
            <DndContext sensors={sensors} collisionDetection={rectIntersection}
              onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
              <SortableContext items={addOnKeys} strategy={verticalListSortingStrategy}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {addOnKeys.map(addOnKey => {
                    const addOn = (draft.addOns ?? {})[addOnKey];
                    if (!addOn) return null;
                    return (
                      <AddOnCard key={addOnKey} addOnKey={addOnKey} addOn={addOn}
                        planKeys={visiblePlanKeys} planIndexMap={planIndexMap} currency={resolvedCurrency}
                        editable
                        featureMap={featureMap} usageLimitMap={usageLimitMap}
                        isDragging={activeAddOnId === addOnKey}
                        onEdit={() => setEditingAddOn(addOnKey)} onRemove={() => handleRemoveAddOn(addOnKey)}
                        onRename={handleAddOnRename}
                        onToggleAvailableFor={(pk) => handleToggleAddOnAvailableFor(addOnKey, pk)}
                        onUpdate={(updates) => handleUpdateAddOn(addOnKey, updates)} />
                    );
                  })}
                </div>
              </SortableContext>
              <DragOverlay dropAnimation={null}>
                {activeAddOnId ? (() => {
                  const addOn = (draft.addOns ?? {})[activeAddOnId];
                  if (!addOn) return null;
                  return (
                    <AddOnCard addOnKey={activeAddOnId} addOn={addOn}
                      planKeys={visiblePlanKeys} planIndexMap={planIndexMap} currency={resolvedCurrency}
                      editable
                      featureMap={featureMap} usageLimitMap={usageLimitMap}
                      isOverlay
                      onEdit={() => {}} onRemove={() => {}}
                      onRename={() => {}}
                      onToggleAvailableFor={() => {}}
                      onUpdate={() => {}} />
                  );
                })() : null}
              </DragOverlay>
            </DndContext>
          </motion.div>
        )}
      </div>

      {/* Side panels */}
      <AnimatePresence>
        {editingPlan && editingPlanData && (
          <PlanSidePanel planKey={editingPlan} plan={editingPlanData} currency={resolvedCurrency}
            onClose={() => setEditingPlan(null)}
            onSave={(key, updates) => { applyMutation(updatePlanProps(draft, editingPlan, updates)); if (key !== editingPlan) { handleRename('plan', editingPlan, key); } setEditingPlan(null); }} />
        )}
        {editingFeature && editingFeatureData && (
          <FeatureSidePanel entityKey={editingFeature} entity={editingFeatureData} isFeature={editingFeatureIsFeature} featureKeys={featureKeys}
            onClose={() => setEditingFeature(null)} onSave={handleSaveEntity} onConvert={handleConvertEntity} />
        )}
        {creatingUsageLimit && (
          <UsageLimitSidePanel featureKeys={featureKeys} onClose={() => setCreatingUsageLimit(false)}
            onSave={(data) => {
              const mutated = structuredClone(draft);
              if (!mutated.usageLimits) mutated.usageLimits = {};
              mutated.usageLimits[data.name] = { description: '', valueType: 'NUMERIC', defaultValue: data.defaultValue, unit: data.unit, type: data.type, linkedFeatures: [data.linkedFeature] };
              for (const plan of Object.values(mutated.plans)) { if (plan.usageLimits !== null && plan.usageLimits !== undefined) plan.usageLimits[data.name] = { value: data.defaultValue }; }
              applyMutation(mutated);
              setCreatingUsageLimit(false);
            }} />
        )}
        {editingAddOn && (draft.addOns ?? {})[editingAddOn] && (
          <AddOnSidePanel
            addOnKey={editingAddOn}
            addOn={draft.addOns![editingAddOn]}
            planKeys={visiblePlanKeys}
            addOnKeys={addOnKeys}
            featureKeys={featureKeys}
            usageLimitKeys={usageLimitKeys}
            currency={resolvedCurrency}
            onClose={() => setEditingAddOn(null)}
            onSave={(key, updates) => {
              applyMutation(updateAddOnProps(draft, editingAddOn, updates));
              if (key !== editingAddOn) handleAddOnRename(editingAddOn, key);
              setEditingAddOn(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
