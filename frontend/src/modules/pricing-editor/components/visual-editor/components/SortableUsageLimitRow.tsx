import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FaTimesCircle } from 'react-icons/fa';
import { FaTrash, FaPencil, FaGripVertical, FaEye, FaEyeSlash } from 'react-icons/fa6';
import { UsageLimit } from 'pricing4ts';
import { formatUsageDisplay } from '../../pricing-renderer/shared/value-helpers';
import { NameInlineEdit } from './NameInlineEdit';
import { CreatingNameInput } from './CreatingNameInput';
import { LABEL_WIDTH, TRAILING_WIDTH } from '../utils/constants';
import type { PricingDraft, DraftUsageLimit } from '../../../services/pricing2yaml';

export function SortableUsageLimitRow({
  usageKey, usage, planKeys, draft,
  onToggleRender, onEdit, onRemove, onRename,
  isCreating, onCreatingConfirm, onCreatingCancel,
}: {
  usageKey: string; usage: DraftUsageLimit;
  planKeys: string[]; draft: PricingDraft;
  onToggleRender: (entityType: 'feature' | 'usageLimit', key: string) => void;
  onEdit: () => void; onRemove: () => void;
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
      <div className={`flex ${isDisabled ? 'opacity-[0.4]' : ''}`} style={{ width: '100%' }}>
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
            <button type="button" onClick={onRemove}
              className="cursor-pointer rounded p-0.5 text-slate-400 transition-colors hover:text-red-500" title="Remove">
              <FaTrash className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
        {/* Values */}
        {planKeys.map((planKey, pIdx) => {
          const plan = draft.plans[planKey];
          if (plan?.private) return <div key={planKey} className="grow min-w-[140px] overflow-hidden border-b border-r border-slate-100 dark:border-slate-800" />;
          const usageValue = (plan?.usageLimits as Record<string, { value: unknown }> | undefined)?.[usageKey]?.value;
          const effectiveValue = usageValue ?? usage.defaultValue;
          const toneClass = pIdx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-800/50';
          const strVal = effectiveValue !== undefined && effectiveValue !== null && effectiveValue !== 0 ? String(effectiveValue) : '';
          return (
            <div key={planKey} className={`flex grow min-w-[140px] overflow-hidden items-center justify-center border-b border-r border-slate-100 px-2 py-3 dark:border-slate-800 ${toneClass}`}>
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
