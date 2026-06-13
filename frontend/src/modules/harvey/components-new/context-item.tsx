import { motion } from 'framer-motion';
import type { PricingContextItem } from '../types/types';
import { contextItemVariants, transitionFast } from '../../core/utils/motion-variants';

interface Props {
  item: PricingContextItem;
  onRemove: (id: string) => void;
}

export default function ContextItem({ item, onRemove }: Props) {
  const originColors: Record<string, string> = {
    user: 'bg-tp-cream text-tp-primary',
    detected: 'bg-blue-50 text-blue-600',
    preset: 'bg-purple-50 text-purple-600',
    agent: 'bg-green-50 text-green-600',
    sphere: 'bg-tp-primary/10 text-tp-primary',
  };

  const isTransforming = item.kind === 'url' && item.transform === 'pending';
  const isDone = item.kind === 'url' && item.transform === 'done';

  return (
    <motion.div
      variants={contextItemVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={transitionFast}
      layout
      className="group flex items-center gap-2 rounded-lg border border-tp-hairline bg-tp-canvas px-3 py-2 transition-colors hover:border-tp-hairline-strong"
    >
      {/* Icon */}
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-tp-surface">
        {item.kind === 'url' ? (
          <svg className="h-3.5 w-3.5 text-tp-steel" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5 text-tp-steel" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-tp-ink">{item.label}</p>
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium ${originColors[item.origin ?? 'user']}`}>
            {item.origin ?? 'user'}
          </span>
          {isTransforming && (
            <span className="flex items-center gap-1 text-[10px] text-tp-steel">
              <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processing
            </span>
          )}
          {isDone && (
            <span className="text-[10px] text-green-600">Ready</span>
          )}
        </div>
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        className="shrink-0 cursor-pointer rounded p-0.5 text-tp-muted opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
        aria-label={`Remove ${item.label}`}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  );
}
