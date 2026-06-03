import { motion } from 'framer-motion';
import { getCurrency } from '../../pricing/components/stats';
import type { PricingEntry } from '../hooks/usePricings';
import type { SphereContextItemInput } from '../types/types';
import PricingVersions from './PricingVersions';

interface PricingListProps {
  pricings: PricingEntry[];
  onContextAdd: (input: SphereContextItemInput) => void;
  onContextRemove: (id: string) => void;
}

function PricingList({ pricings, onContextAdd, onContextRemove }: PricingListProps) {
  if (pricings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline-soft bg-tp-canvas py-12 text-center">
        <p className="text-sm font-medium text-tp-ink">No pricings found</p>
        <p className="mt-1 text-xs text-tp-steel">Try adjusting your search or filters.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {pricings.map(item => {
        const symbol = getCurrency(item.currency);
        const configSize = item.analytics?.configurationSpaceSize ?? 0;
        const minPrice = item.analytics?.minSubscriptionPrice ?? 0;
        const maxPrice = item.analytics?.maxSubscriptionPrice ?? 0;
        const orgInitial = item.organization?.name?.[0]?.toUpperCase() ?? 'O';
        const orgLabel = item.organization?.displayName || item.organization?.name || '';
        const collectionName = item.collection?.name;
        const slug = item.collection?.slug;

        return (
          <motion.div
            key={`${item.organization?.name ?? 'org'}-${item.name}-${slug ?? 'nocollection'}`}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.15 }}
            className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4 transition-colors hover:border-tp-hairline-strong hover:shadow-elevation-2"
          >
            {/* Header */}
            <div className="mb-3 flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-tp-cream text-[10px] font-bold text-tp-primary">
                    {orgInitial}
                  </span>
                  <span className="truncate text-[11px] text-tp-steel">{orgLabel}</span>
                  {collectionName && (
                    <>
                      <span className="text-tp-hairline">/</span>
                      <span className="truncate text-[11px] text-tp-steel">{collectionName}</span>
                    </>
                  )}
                </div>
                <h3 className="truncate text-sm font-medium text-tp-ink">{item.name}</h3>
              </div>
            </div>

            {/* Stats */}
            <div className="mb-3 flex items-center gap-3 text-[11px] text-tp-steel">
              <span className="inline-flex items-center gap-1 rounded bg-tp-surface px-1.5 py-0.5">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621.504-1.125 1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621-.504 1.125-1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 12 6 12.504 6 13.125" />
                </svg>
                {configSize.toLocaleString()} configs
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-tp-surface px-1.5 py-0.5">
                {symbol}{minPrice.toFixed(0)}–{symbol}{maxPrice.toFixed(0)}
              </span>
            </div>

            {/* Versions */}
            <PricingVersions
              owner={item.organization?.name ?? ''}
              slug={item.slug}
              collectionSlug={slug}
              onContextAdd={onContextAdd}
              onContextRemove={onContextRemove}
            />
          </motion.div>
        );
      })}
    </div>
  );
}

export default PricingList;
