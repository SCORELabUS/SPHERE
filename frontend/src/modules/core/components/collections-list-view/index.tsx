import { useCallback, useEffect, useMemo, useState } from 'react';
import Skeleton from 'react-loading-skeleton';
import CollectionCard from '../../../pricing/components/collection-card';
import SearchInput from '../../../pricing/components/search-input';
import FilterBar from '../../../pricing/components/filter-bar';
import Pagination from '../../../pricing/components/pagination';
import { motion } from 'framer-motion';
import { staggerContainer, fadeInUp, transitionDefault } from '../../utils/motion-variants';

export interface CollectionEntry {
  id: string;
  name: string;
  slug: string;
  organization: { id: string; name: string; displayName: string; avatar: string };
  numberOfPricings: number;
}

interface FetchResult {
  collections: CollectionEntry[];
  total: number;
}

interface Props {
  fetchCollections: (filters: Record<string, string>) => Promise<FetchResult>;
  title: string;
  subtitle: string;
  perPage?: number;
}

export default function CollectionsListView({ fetchCollections, title, subtitle, perPage = 12 }: Props) {
  const [collections, setCollections] = useState<CollectionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [textFilter, setTextFilter] = useState('');
  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const filters: Record<string, string> = { limit: String(perPage), offset: String((page - 1) * perPage) };
      if (textFilter) filters.name = textFilter;
      if (selectedOwners.length > 0) filters.selectedOwners = selectedOwners.join(',');

      const data = await fetchCollections(filters);
      setCollections(data.collections ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setCollections([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, textFilter, selectedOwners, perPage, fetchCollections]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const ownerFilters = useMemo(() => {
    const counts: Record<string, number> = {};
    collections.forEach(c => {
      const name = c.organization.displayName || c.organization.name;
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts).map(([label, count]) => ({ label, value: label, count }));
  }, [collections]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transitionDefault}
        className="mb-6"
      >
        <h1 className="font-display text-2xl font-normal text-tp-ink">{title}</h1>
        <p className="mt-1 text-sm text-tp-steel">{subtitle}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...transitionDefault, delay: 0.05 }}
        className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="w-full sm:max-w-[20rem]">
          <SearchInput
            placeholder="Search collections..."
            onSearch={(v) => { setTextFilter(v); setPage(1); }}
          />
        </div>
        <FilterBar
          ownerFilters={ownerFilters}
          selectedOwners={selectedOwners}
          onOwnersChange={(o) => { setSelectedOwners(o); setPage(1); }}
          onClear={() => { setSelectedOwners([]); setTextFilter(''); setPage(1); }}
        />
      </motion.div>

      <div className="mb-4 text-xs text-tp-steel">
        {isLoading ? 'Loading...' : `${total} ${total === 1 ? 'collection' : 'collections'} found`}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: perPage }).map((_, i) => (
            <Skeleton key={i} height={112} />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline bg-tp-canvas py-16 text-center">
          <svg className="mb-3 h-10 w-10 text-tp-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
          <p className="text-sm font-medium text-tp-ink">No collections found</p>
          <p className="mt-1 text-xs text-tp-steel">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {collections.map((collection) => (
            <motion.div key={collection.id} variants={fadeInUp} transition={transitionDefault}>
              <CollectionCard collection={collection} />
            </motion.div>
          ))}
        </motion.div>
      )}

      <div className="mt-6">
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}
