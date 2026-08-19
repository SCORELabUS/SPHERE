import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FaTrash, FaPencil, FaGripVertical, FaEye, FaEyeSlash } from 'react-icons/fa6';
import { UsageLimit } from 'pricing4ts';
import { NameInlineEdit } from './NameInlineEdit';
import { CreatingNameInput } from './CreatingNameInput';
import { UsageValueCell } from './UsageValueCell';
import { LABEL_WIDTH, TRAILING_WIDTH } from '../utils/constants';
import type { PricingDraft, DraftUsageLimit } from '../../../services/pricing2yaml';

export function SortableUsageLimitRow({
  usageKey, usage, planKeys, draft,
  onToggleRender, onEdit, onRemove, onRename, onSetCellValue,
  isCreating, onCreatingConfirm, onCreatingCancel,
}: {
  usageKey: string; usage: DraftUsageLimit;
  planKeys: string[]; draft: PricingDraft;
  onToggleRender: (entityType: 'feature' | 'usageLimit', key: string) => void;
  onEdit: () => void; onRemove: () => void;
  onRename: (oldKey: string, newKey: string) => void;
  onSetCellValue: (planKey: string, cellType: 'feature' | 'usageLimit', cellKey: string, value: string | number | boolean) => void;
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
        <div className="relative flex shrink-0 items-center gap-1.5 overflow-hidden border-b border-r border-slate-200 bg-slate-50/50 px-4 py-3 pr-24 md:pr-4 dark:border-slate-700 dark:bg-slate-800/50"
          style={{ width: LABEL_WIDTH }}>
          {isCreating ? (
            <CreatingNameInput
              initialKey={usageKey}
              onConfirm={onCreatingConfirm!}
              onCancel={onCreatingCancel!}
            />
          ) : (
            <>
              <div {...listeners} className="shrink-0 cursor-grab text-slate-300 opacity-100 transition-opacity hover:text-slate-500 active:cursor-grabbing md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                <FaGripVertical className="h-3 w-3" />
              </div>
              <div className="min-w-0 flex-1 leading-snug">
                <NameInlineEdit value={usageKey} onSave={(newKey) => onRename(usageKey, newKey)}
                  truncate={false}
                  className="text-left text-sm font-semibold text-slate-700 dark:text-slate-300" />
                <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">({usage.unit})</span>
              </div>
            </>
          )}
          <div className="absolute right-1 top-0.5 z-20 flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            <button type="button" onClick={() => onToggleRender('usageLimit', usageKey)}
              className={`flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-slate-200/70 dark:hover:bg-slate-700 ${isDisabled ? 'text-slate-300 hover:text-amber-500' : 'text-amber-500 hover:text-slate-500'}`}
              aria-label={isDisabled ? 'Show row' : 'Hide row'} title={isDisabled ? 'Show row' : 'Hide row'}>
              {isDisabled ? <FaEyeSlash className="size-3" /> : <FaEye className="size-3" />}
            </button>
            <button type="button" onClick={onEdit}
              className="flex size-8 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-500 dark:hover:bg-indigo-950/50" aria-label="Edit" title="Edit">
              <FaPencil className="size-3" />
            </button>
            <button type="button" onClick={onRemove}
              className="flex size-8 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50" aria-label="Remove" title="Remove">
              <FaTrash className="size-3" />
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
          return (
            <div key={planKey} className={`flex grow min-w-[140px] overflow-hidden items-center justify-center border-b border-r border-slate-100 px-2 py-3 dark:border-slate-800 ${toneClass}`}>
              <UsageValueCell value={effectiveValue as string | number | boolean} usage={usage as unknown as UsageLimit}
                onSave={(v) => onSetCellValue(planKey, 'usageLimit', usageKey, v)} />
            </div>
          );
        })}
        <div className="shrink-0 border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800" style={{ width: TRAILING_WIDTH }} />
      </div>
    </div>
  );
}
