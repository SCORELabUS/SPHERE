import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { FaTrash, FaPencil, FaGripVertical } from 'react-icons/fa6';
import PALETTE from '../../pricing-renderer/shared/planPalette';
import { NameInlineEdit } from './NameInlineEdit';
import { HeaderInlineEdit } from './HeaderInlineEdit';
import type { DraftPlan } from '../../../services/pricing2yaml';

export function SortablePlanHeader({
  planKey, index, plan, currency, isHovered, onHover, onEdit, onRemove, onPriceChange, onUnitChange, onRename, canRemove,
}: {
  planKey: string; index: number; plan: DraftPlan; currency: string;
  isHovered: boolean; onHover: (hovered: boolean) => void;
  onEdit: () => void; onRemove: () => void;
  onPriceChange: (v: string) => void; onUnitChange: (v: string) => void;
  onRename: (oldKey: string, newKey: string) => void;
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
      className="group relative shrink-0 grow min-w-[140px] overflow-hidden border-b border-r border-slate-200 px-2 py-0 dark:border-slate-700"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="absolute inset-0 rounded-t-lg" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
      <div className="relative flex flex-col items-center overflow-hidden pb-4 pt-9 text-center md:py-4">
        <div {...listeners} className="absolute left-1 top-2 cursor-grab text-white/40 hover:text-white/80 active:cursor-grabbing">
          <FaGripVertical className="h-3 w-3" />
        </div>
        <div className="w-full truncate px-5">
          <NameInlineEdit value={planKey} onSave={(newKey) => onRename(planKey, newKey)} light
            className="!text-white !font-bold !uppercase tracking-wide rounded px-2 py-0.5" />
        </div>
        <div className="mt-1 flex w-full items-center justify-center truncate px-2">
          <span className="flex items-center truncate text-base font-bold text-white">
            <HeaderInlineEdit value={String(plan.price)} onSave={onPriceChange} className="!text-base !font-bold !text-white" numeric selectOnFocus />
            <span className="ml-0.5 shrink-0 text-sm font-normal text-white/70">{currency}</span>
          </span>
        </div>
        {plan.unit && <div className="mt-0.5 w-full truncate px-2"><HeaderInlineEdit value={plan.unit} onSave={onUnitChange} className="!text-xs !text-white/70" /></div>}
      </div>
      <div className={`absolute right-1 top-1 z-10 flex gap-0.5 opacity-100 transition-opacity ${isHovered ? 'md:opacity-100' : 'md:pointer-events-none md:opacity-0'}`}>
          <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} type="button"
            onClick={onEdit}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md bg-white/20 text-white/70 backdrop-blur-sm transition-colors hover:bg-white/30 hover:text-white md:size-auto md:p-1"
            title="Edit plan details"><FaPencil className="h-2.5 w-2.5" /></motion.button>
          {canRemove && (
            <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} type="button"
              onClick={onRemove}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md bg-red-500/20 text-red-200 backdrop-blur-sm transition-colors hover:bg-red-500/40 hover:text-red-100 md:size-auto md:p-1"
              title="Remove plan"><FaTrash className="h-2.5 w-2.5" /></motion.button>
          )}
      </div>
    </div>
  );
}
