import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'framer-motion';
import { FaCheckCircle, FaTimesCircle } from 'react-icons/fa';
import { FaTrash, FaPencil, FaGripVertical, FaEye, FaEyeSlash } from 'react-icons/fa6';
import { CellInlineEdit } from './CellInlineEdit';
import { NameInlineEdit } from './NameInlineEdit';
import { FAST_SPRING, LABEL_WIDTH, TRAILING_WIDTH } from '../utils/constants';
import type { PricingDraft, DraftFeature } from '../../../services/pricing2yaml';

export function SortableFeatureRow({
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
      <div className={`flex ${isDisabled ? 'opacity-[0.4]' : ''}`} style={{ width: '100%' }}>
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
          if (plan?.private) return <div key={planKey} className="grow min-w-[140px] overflow-hidden border-b border-r border-slate-100 dark:border-slate-800" />;
          const featureValue = (plan?.features as Record<string, { value: unknown }> | undefined)?.[featureKey]?.value;
          const globalDefault = feature.defaultValue;
          const effectiveValue = featureValue ?? globalDefault;
          const toneClass = pIdx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/50';

          if (typeof effectiveValue === 'boolean') {
            return (
              <div key={planKey} className={`flex grow min-w-[140px] overflow-hidden items-center justify-center border-b border-r border-slate-100 px-2 py-3 dark:border-slate-800 ${toneClass}`}>
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
            <div key={planKey} className={`flex grow min-w-[140px] overflow-hidden items-center justify-center border-b border-r border-slate-100 px-2 py-3 dark:border-slate-800 ${toneClass}`}>
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
