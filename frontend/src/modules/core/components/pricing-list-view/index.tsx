import { useCallback, useEffect, useMemo, useState } from 'react';
import Skeleton from 'react-loading-skeleton';
import PricingCard from '../../../pricing/components/pricing-card';
import SearchInput from '../../../pricing/components/search-input';
import Pagination from '../../../pricing/components/pagination';
import DualRangeSlider from '../../../pricing/components/dual-range-slider';
import { motion, AnimatePresence } from 'framer-motion';
import { staggerContainer, fadeInUp, transitionDefault } from '../../utils/motion-variants';

type FilterHistogram = { max: number; min: number; data: { value: string; count: number }[] };

export interface PricingEntry {
  name: string;
  slug: string;
  organization: { id: string; name: string; displayName: string; avatar: string };
  version: string;
  collection: { id: string; name: string; slug: string };
  createdAt: string;
  currency: string;
  analytics: {
    configurationSpaceSize: number;
    minSubscriptionPrice: number;
    maxSubscriptionPrice: number;
  };
}

interface FetchResult {
  pricings: PricingEntry[];
  total: number;
  minPrice?: FilterHistogram;
  maxPrice?: FilterHistogram;
  configurationSpaceSize?: FilterHistogram;
}

interface Props {
  fetchPricings: (filters: Record<string, string>) => Promise<FetchResult>;
  title: string;
  subtitle: string;
  perPage?: number;
}

export default function PricingListView({ fetchPricings, title, subtitle, perPage = 12 }: Props) {
  const [pricings, setPricings] = useState<PricingEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const [searchText, setSearchText] = useState('');

  const [draftOwners, setDraftOwners] = useState<string[]>([]);
  const [committedOwners, setCommittedOwners] = useState<string[]>([]);

  const [draftMinPrice, setDraftMinPrice] = useState<[number, number]>([0, 0]);
  const [draftMaxPrice, setDraftMaxPrice] = useState<[number, number]>([0, 0]);
  const [committedMinPrice, setCommittedMinPrice] = useState<[number, number]>([0, 0]);
  const [committedMaxPrice, setCommittedMaxPrice] = useState<[number, number]>([0, 0]);

  const [draftConfig, setDraftConfig] = useState<[number, number]>([0, 0]);
  const [committedConfig, setCommittedConfig] = useState<[number, number]>([0, 0]);

  const [limits, setLimits] = useState<{ minPrice?: FilterHistogram; maxPrice?: FilterHistogram; configurationSpaceSize?: FilterHistogram } | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const p: Record<string, string> = {};
      p.limit = String(perPage);
      p.offset = String((page - 1) * perPage);
      if (searchText) p.name = searchText;
      if (committedOwners.length > 0) p.selectedOwners = committedOwners.join(',');
      if (limits) {
        if (committedMinPrice[0] > 0) p['min-minPrice'] = String(committedMinPrice[0]);
        if (committedMinPrice[1] < limits.minPrice!.max) p['max-minPrice'] = String(committedMinPrice[1]);
        if (committedMaxPrice[0] > 0) p['min-maxPrice'] = String(committedMaxPrice[0]);
        if (committedMaxPrice[1] < limits.maxPrice!.max) p['max-maxPrice'] = String(committedMaxPrice[1]);
        if (committedConfig[0] > 0) p['min-configurationSpaceSize'] = String(committedConfig[0]);
        if (committedConfig[1] < limits.configurationSpaceSize!.max) p['max-configurationSpaceSize'] = String(committedConfig[1]);
      }

      const data = await fetchPricings(p);
      setPricings(data.pricings ?? []);
      setTotal(data.total ?? 0);

      if (!limits) {
        const l: { minPrice?: FilterHistogram; maxPrice?: FilterHistogram; configurationSpaceSize?: FilterHistogram } = {};
        if (data.minPrice) l.minPrice = data.minPrice;
        if (data.maxPrice) l.maxPrice = data.maxPrice;
        if (data.configurationSpaceSize) l.configurationSpaceSize = data.configurationSpaceSize;
        setLimits(l);
        if (data.minPrice) { const v: [number, number] = [0, data.minPrice.max]; setDraftMinPrice(v); setCommittedMinPrice(v); }
        if (data.maxPrice) { const v: [number, number] = [0, data.maxPrice.max]; setDraftMaxPrice(v); setCommittedMaxPrice(v); }
        if (data.configurationSpaceSize) { const v: [number, number] = [0, data.configurationSpaceSize.max]; setDraftConfig(v); setCommittedConfig(v); }
      }
    } catch {
      setPricings([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, searchText, committedOwners, committedMinPrice, committedMaxPrice, committedConfig, limits, perPage, fetchPricings]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const ownerFilters = useMemo(() => {
    const c: Record<string, number> = {};
    pricings.forEach(p => { const n = p.organization.displayName || p.organization.name; c[n] = (c[n] || 0) + 1; });
    return Object.entries(c).map(([label, count]) => ({ label, value: label, count }));
  }, [pricings]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const hasActive = committedOwners.length > 0 ||
    committedMinPrice[0] > 0 || committedMinPrice[1] < (limits?.minPrice?.max ?? 0) ||
    committedMaxPrice[0] > 0 || committedMaxPrice[1] < (limits?.maxPrice?.max ?? 0) ||
    committedConfig[0] > 0 || committedConfig[1] < (limits?.configurationSpaceSize?.max ?? 0);

  const applyFilters = () => {
    setCommittedOwners(draftOwners);
    setCommittedMinPrice(draftMinPrice);
    setCommittedMaxPrice(draftMaxPrice);
    setCommittedConfig(draftConfig);
    setPage(1);
  };

  const clearAll = () => {
    setDraftOwners([]); setCommittedOwners([]);
    setSearchText('');
    if (limits?.minPrice) { const v: [number, number] = [0, limits.minPrice.max]; setDraftMinPrice(v); setCommittedMinPrice(v); }
    if (limits?.maxPrice) { const v: [number, number] = [0, limits.maxPrice.max]; setDraftMaxPrice(v); setCommittedMaxPrice(v); }
    if (limits?.configurationSpaceSize) { const v: [number, number] = [0, limits.configurationSpaceSize.max]; setDraftConfig(v); setCommittedConfig(v); }
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={transitionDefault} className="mb-6">
        <h1 className="font-display text-2xl font-normal text-tp-ink">{title}</h1>
        <p className="mt-1 text-sm text-tp-steel">{subtitle}</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...transitionDefault, delay: 0.05 }} className="mb-5 flex items-center gap-3">
        <div className="flex-1">
          <SearchInput placeholder="Search by name..." onSearch={(v) => { setSearchText(v); setPage(1); }} />
        </div>
        <button
          type="button" onClick={() => setShowFilters(!showFilters)}
          className={`flex cursor-pointer shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            hasActive ? 'border-tp-primary/30 bg-tp-primary/5 text-tp-primary' : 'border-tp-hairline-strong bg-tp-canvas text-tp-slate hover:border-tp-hairline hover:text-tp-ink'
          }`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 00-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          Filters
          {hasActive && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-tp-primary text-[9px] text-tp-on-primary">!</span>}
        </button>
      </motion.div>

      <AnimatePresence>
        {showFilters && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="mb-5 rounded-xl border border-tp-hairline bg-tp-canvas p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {ownerFilters.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-medium text-tp-steel">Owner ({ownerFilters.length})</label>
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-tp-hairline p-1.5">
                      {ownerFilters.map(o => (
                        <label key={o.value} className="flex cursor-pointer items-center gap-1.5 text-xs text-tp-slate hover:text-tp-ink">
                          <input type="checkbox" checked={draftOwners.includes(o.value)} onChange={() => setDraftOwners(p => p.includes(o.value) ? p.filter(x => x !== o.value) : [...p, o.value])} className="h-3.5 w-3.5 rounded border-tp-hairline-strong text-tp-primary focus:ring-tp-primary" />
                          <span className="flex-1 truncate">{o.label}</span>
                          <span className="text-[10px] text-tp-muted">{o.count}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {limits?.minPrice && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-medium text-tp-steel">Min Price</label>
                    <DualRangeSlider min={0} max={limits.minPrice.max} value={draftMinPrice} onChange={setDraftMinPrice} formatLabel={v => `$${v.toFixed(0)}`} />
                  </div>
                )}

                {limits?.maxPrice && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-medium text-tp-steel">Max Price</label>
                    <DualRangeSlider min={0} max={limits.maxPrice.max} value={draftMaxPrice} onChange={setDraftMaxPrice} formatLabel={v => `$${v.toFixed(0)}`} />
                  </div>
                )}

                {limits?.configurationSpaceSize && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-medium text-tp-steel">Config Space</label>
                    <DualRangeSlider min={0} max={limits.configurationSpaceSize.max} value={draftConfig} onChange={setDraftConfig} formatLabel={v => v.toLocaleString()} />
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                {hasActive && <button type="button" onClick={clearAll} className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-tp-muted hover:text-red-500">Clear all</button>}
                <button type="button" onClick={applyFilters} className="cursor-pointer rounded-lg bg-tp-primary px-4 py-1.5 text-xs font-medium text-tp-on-primary transition-colors hover:bg-tp-primary-deep">Apply filters</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mb-4 text-xs text-tp-steel">{isLoading ? 'Loading...' : `${total} ${total === 1 ? 'pricing' : 'pricings'} found`}</div>

      <div className="min-h-170">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: perPage }).map((_, i) => <Skeleton key={i} height={128} />)}
          </div>
        ) : pricings.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline bg-tp-canvas py-16 text-center">
            <svg className="mb-3 h-10 w-10 text-tp-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
            <p className="text-sm font-medium text-tp-ink">No pricings found</p>
            <p className="mt-1 text-xs text-tp-steel">Try adjusting your search or filters.</p>
          </div>
        ) : (
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pricings.map(p => (
              <motion.div key={`${p.organization.name}-${p.name}`} variants={fadeInUp} transition={transitionDefault}>
                <PricingCard data={p} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      <div className="mt-6"><Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} /></div>
    </div>
  );
}
