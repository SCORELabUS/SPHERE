import { motion } from 'framer-motion';
import { FaFileInvoiceDollar } from 'react-icons/fa';
import { transitionDefault } from '../../../../core/utils/motion-variants';
import { OrgPricing } from '../../../api/organizationsApi';
import PricingCard from '../../../../pricing/components/pricing-card';
import Pagination from '../../../../pricing/components/pagination';
import { PER_PAGE } from '../types';

interface Props {
  pricings: OrgPricing[];
  pricingsTotal: number;
  pricingPage: number;
  pricingSearch: string;
  showOnlyUnlinked: boolean;
  onPageChange: (page: number) => void;
  onSearchChange: (value: string) => void;
  onToggleUnlinked: (value: boolean) => void;
}

export default function PricingsTab({ pricings, pricingsTotal, pricingPage, pricingSearch, showOnlyUnlinked, onPageChange, onSearchChange, onToggleUnlinked }: Props) {
  return (
    <motion.div
      key="pricings"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={transitionDefault}
    >
      <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas">
        <div className="flex flex-col gap-3 border-b border-tp-hairline-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg text-tp-ink">Pricings</h2>
            <p className="text-xs text-tp-steel">Pricings owned by this organization.</p>
          </div>
          <div className="flex flex-col gap-2 sm:w-64">
            <input
              type="text"
              value={pricingSearch}
              onChange={(e) => { onSearchChange(e.target.value); onPageChange(1); }}
              placeholder="Search pricings..."
              className="h-9 w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 text-sm text-tp-ink placeholder-tp-muted transition-colors focus:border-tp-primary focus:outline-none"
            />
            <label className="flex cursor-pointer items-center gap-2 text-xs text-tp-steel">
              <input
                type="checkbox"
                checked={showOnlyUnlinked}
                onChange={(e) => { onToggleUnlinked(e.target.checked); onPageChange(1); }}
                className="h-3.5 w-3.5 rounded border-tp-input-border text-tp-primary focus:ring-tp-primary"
              />
              Only unlinked pricings
            </label>
          </div>
        </div>

        <div className="min-h-105 p-4">
          {pricings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-tp-ink">
              <FaFileInvoiceDollar size={32} className="text-tp-muted" />
              <p className="text-sm">No pricings found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pricings.map((pricing) => (
                <PricingCard key={`${pricing.name}-${pricing.version}`} data={pricing} />
              ))}
            </div>
          )}
        </div>

        {pricingsTotal > PER_PAGE && (
          <div className="border-t border-tp-hairline-soft px-5 py-3">
            <Pagination
              currentPage={pricingPage}
              totalPages={Math.ceil(pricingsTotal / PER_PAGE)}
              onPageChange={onPageChange}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
