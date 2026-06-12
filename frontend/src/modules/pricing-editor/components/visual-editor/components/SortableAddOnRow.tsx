import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'framer-motion';
import { FaCheckCircle, FaTimesCircle } from 'react-icons/fa';
import { FaTrash, FaPencil, FaGripVertical } from 'react-icons/fa6';
import { NameInlineEdit } from './NameInlineEdit';
import { CreatingNameInput } from './CreatingNameInput';
import { LABEL_WIDTH, TRAILING_WIDTH, FAST_SPRING } from '../utils/constants';
import type { PricingDraft, DraftAddOn } from '../../../services/pricing2yaml';

export function SortableAddOnRow({
  addOnKey, addOn, planKeys, draft, currency,
  onToggleAvailableFor, onEdit, onRemove, onRename,
  isCreating, onCreatingConfirm, onCreatingCancel,
}: {
  addOnKey: string; addOn: DraftAddOn;
  planKeys: string[]; draft: PricingDraft; currency: string;
  onToggleAvailableFor: (planKey: string) => void;
  onEdit: () => void; onRemove: () => void;
  onRename: (oldKey: string, newKey: string) => void;
  isCreating?: boolean;
  onCreatingConfirm?: (newKey: string) => void;
  onCreatingCancel?: () => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: addOnKey });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const isAvailableFor = (planKey: string) => {
    if (!addOn.availableFor) return true;
    return addOn.availableFor.includes(planKey);
  };

  const priceDisplay = typeof addOn.price === 'number'
    ? `${currency}${addOn.price}`
    : addOn.price || '0';

  return (
    <div ref={setNodeRef} style={style} className="group">
      <div className="flex" style={{ width: '100%' }}>
        {/* Label cell */}
        <div className="relative flex shrink-0 items-start gap-1.5 overflow-hidden border-b border-r border-slate-200 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50"
          style={{ width: LABEL_WIDTH }}>
          {isCreating ? (
            <CreatingNameInput
              initialKey={addOnKey}
              onConfirm={onCreatingConfirm!}
              onCancel={onCreatingCancel!}
            />
          ) : (
            <>
              <div {...listeners} className="mt-0.5 shrink-0 cursor-grab text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-500 active:cursor-grabbing">
                <FaGripVertical className="h-3 w-3" />
              </div>
              <div className="min-w-0 flex-1 truncate">
                <NameInlineEdit value={addOnKey} onSave={(newKey) => onRename(addOnKey, newKey)}
                  className="text-sm font-semibold text-slate-700 dark:text-slate-300" />
                <div className="mt-1 truncate">
                  <span className="inline-block rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                    {priceDisplay}
                    {addOn.unit && <span className="text-indigo-400 dark:text-indigo-500">/{addOn.unit}</span>}
                  </span>
                </div>
              </div>
            </>
          )}
          <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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

        {/* Available-for toggles per plan */}
        {planKeys.map((planKey, pIdx) => {
          const plan = draft.plans[planKey];
          if (plan?.private) return <div key={planKey} className="grow min-w-[140px] overflow-hidden border-b border-r border-slate-100 dark:border-slate-800" />;
          const available = isAvailableFor(planKey);
          const toneClass = pIdx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/50';
          return (
            <div key={planKey} className={`flex grow min-w-[140px] overflow-hidden items-center justify-center border-b border-r border-slate-100 px-2 py-3 dark:border-slate-800 ${toneClass}`}>
              <motion.div className="flex cursor-pointer items-center justify-center"
                onClick={() => onToggleAvailableFor(planKey)}
                whileTap={{ scale: 0.8 }} transition={FAST_SPRING}
              >
                <AnimatePresence mode="wait">
                  {available ? (
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
        })}

        {/* Empty trailing cell */}
        <div className="shrink-0 border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800" style={{ width: TRAILING_WIDTH }} />
      </div>
    </div>
  );
}
