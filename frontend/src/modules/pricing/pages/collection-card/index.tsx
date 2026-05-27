import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Skeleton from 'react-loading-skeleton';
import { usePricingCollectionsApi } from '../../../profile/api/pricingCollectionsApi';
import { usePricingsApi } from '../../api/pricingsApi';
import { useAuth } from '../../../auth/hooks/useAuth';
import { useRecentItems } from '../../../core/hooks/useRecentItems';
import PricingCard from '../../components/pricing-card';
import Pagination from '../../components/pagination';
import CollectionSettings, { type CollectionPermissions } from '../../components/collection-settings';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from '../../../core/hooks/useRouter';
import { transitionDefault, staggerContainer, fadeInUp } from '../../../core/utils/motion-variants';
import DatePicker from '../../../core/components/date-picker';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Collection } from '../../types/collection';
import CollectionCardSkeleton from '../../../core/components/skeletons/collection-card-skeleton';

type Tab = 'pricings' | 'analytics' | 'settings';

interface PricingEntry {
  name: string;
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

const PRICINGS_PER_PAGE = 12;
const axisTick = { fill: '#4a4a4a', fontSize: 11 };
const compactNum = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fmtY = (v: number) => { if (!Number.isFinite(v)) return ''; return Math.abs(v) >= 1000 ? compactNum.format(v) : String(v); };

export default function CollectionCardPage() {
  const { ownerId, collectionSlug } = useParams<{ ownerId: string; collectionSlug: string }>();
  const router = useRouter();
  const { getCollectionByOwnerAndName, downloadCollection, getCollectionPermissions } = usePricingCollectionsApi();
  const { getPricings } = usePricingsApi();
  const { authUser } = useAuth();
  const { addRecentCollection } = useRecentItems();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [isLoadingCollection, setIsLoadingCollection] = useState(true);
  const [tab, setTab] = useState<Tab>('pricings');
  const [sortAsc, setSortAsc] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [permissions, setPermissions] = useState<CollectionPermissions>({ GET: true, PUT: false, DELETE: false });

  const [pricings, setPricings] = useState<PricingEntry[]>([]);
  const [pricingsTotal, setPricingsTotal] = useState(0);
  const [pricingsPage, setPricingsPage] = useState(1);
  const [isLoadingPricings, setIsLoadingPricings] = useState(true);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (!ownerId || !collectionSlug) return;
    setIsLoadingCollection(true);
    getCollectionByOwnerAndName(ownerId, collectionSlug)
      .then(data => setCollection(data))
      .catch(() => {})
      .finally(() => setIsLoadingCollection(false));
  }, [ownerId, collectionSlug]);

  // Track visit for recent items
  useEffect(() => {
    if (!authUser.isAuthenticated || !ownerId || !collectionSlug) return;
    addRecentCollection({
      id: `${ownerId}/${collectionSlug}`,
      name: collectionSlug,
      orgId: ownerId,
      orgName: collection?.organization?.name ?? ownerId,
    });
  }, [ownerId, collectionSlug, collection?.organization?.name, authUser.isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ownerId || !collectionSlug || !authUser?.isAuthenticated) return;
    getCollectionPermissions(ownerId, collectionSlug)
      .then(data => setPermissions(data))
      .catch(() => {});
  }, [ownerId, collectionSlug, authUser?.isAuthenticated]);

  const fetchPricings = useCallback(async () => {
    if (!collectionSlug) return;
    setIsLoadingPricings(true);
    try {
      const filters: Record<string, string | number> = {
        collectionSlug: collection?.slug || collectionSlug,
        limit: PRICINGS_PER_PAGE,
        offset: (pricingsPage - 1) * PRICINGS_PER_PAGE,
        sortBy: 'name',
        sort: sortAsc ? 'asc' : 'desc',
      };
      const data = await getPricings(filters as Record<string, string>);
      setPricings(data.pricings ?? []);
      setPricingsTotal(data.total ?? 0);
    } catch {
      setPricings([]);
    } finally {
      setIsLoadingPricings(false);
    }
  }, [collection, collectionSlug, pricingsPage, sortAsc]);

  useEffect(() => {
    fetchPricings();
  }, [fetchPricings]);

  const analytics = collection?.analytics;
  const d = collection?.data;

  const handleDownload = async () => {
    if (!ownerId || !collectionSlug) return;
    setIsDownloading(true);
    try { await downloadCollection(ownerId, collectionSlug); } catch { /* download failed */ }
    setIsDownloading(false);
  };

  const handleCollectionUpdated = (updated: Collection) => {
    setCollection(updated);
  };

  const handleSortToggle = () => {
    setSortAsc(!sortAsc);
    setPricingsPage(1);
  };

  const pricingsTotalPages = Math.max(1, Math.ceil(pricingsTotal / PRICINGS_PER_PAGE));

  const filteredEvolution = useMemo(() => {
    if (!analytics) return null;
    const filterSeries = (series: { dates: string[]; values: number[] }) => {
      let dates = [...series.dates];
      let values = [...series.values];
      if (dateFrom) {
        const from = dateFrom + 'T00:00:00';
        const idx = dates.findIndex(d => d >= from);
        if (idx > 0) { dates = dates.slice(idx); values = values.slice(idx); }
        else if (idx === -1) { dates = []; values = []; }
      }
      if (dateTo) {
        const to = dateTo + 'T23:59:59';
        const idx = dates.findLastIndex(d => d <= to);
        if (idx >= 0 && idx < dates.length - 1) { dates = dates.slice(0, idx + 1); values = values.slice(0, idx + 1); }
        else if (idx === -1) { dates = []; values = []; }
      }
      return { dates, values };
    };
    return {
      configSpace: filterSeries(analytics.evolutionOfConfigurationSpaceSize),
      plans: filterSeries(analytics.evolutionOfPlans),
      features: filterSeries(analytics.evolutionOfFeatures),
      addOns: filterSeries(analytics.evolutionOfAddOns),
    };
  }, [analytics, dateFrom, dateTo]);

  const chartData = useMemo(() => {
    if (!filteredEvolution) return [];
    const len = filteredEvolution.configSpace.dates.length;
    return Array.from({ length: len }, (_, i) => ({
      date: new Date(filteredEvolution.configSpace.dates[i]).toLocaleDateString(),
      configSpace: filteredEvolution.configSpace.values[i] ?? 0,
      plans: filteredEvolution.plans.values[i] ?? 0,
      features: filteredEvolution.features.values[i] ?? 0,
      addOns: filteredEvolution.addOns.values[i] ?? 0,
    }));
  }, [filteredEvolution]);

  const avgPrices = useMemo(() => {
    if (pricings.length === 0) return { avgMin: 0, avgMax: 0 };
    const sumMin = pricings.reduce((s, p) => s + (p.analytics?.minSubscriptionPrice ?? 0), 0);
    const sumMax = pricings.reduce((s, p) => s + (p.analytics?.maxSubscriptionPrice ?? 0), 0);
    return { avgMin: sumMin / pricings.length, avgMax: sumMax / pricings.length };
  }, [pricings]);

  const showSettingsTab = permissions.PUT || permissions.DELETE;

  const availableTabs: [Tab, string][] = [
    ['pricings', 'Pricings'],
    ['analytics', 'Analytics'],
    ...(showSettingsTab ? [['settings', 'Settings'] as [Tab, string]] : []),
  ];

  if (isLoadingCollection) {
    return <CollectionCardSkeleton />;
  }

  return (
    <>
      <Helmet><title>SPHERE - {collection?.name || collectionSlug}</title></Helmet>

      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={transitionDefault} className="mb-6">
          <div className="mb-2 flex items-center gap-2 text-xs text-tp-steel">
            <button type="button" onClick={() => router.push('/collections')} className="cursor-pointer hover:text-tp-ink">Collections</button>
            <span>/</span>
            <span className="text-tp-ink">{collection?.name || collectionSlug}</span>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="font-display text-2xl font-normal text-tp-ink">{collection?.name || collectionSlug}</h1>
              <p className="mt-1 text-sm text-tp-steel">
                {collection?.organization?.displayName || collection?.organization?.name}
                {collection?.description && <span className="ml-1">· {collection.description}</span>}
              </p>
            </div>
            <button
              type="button" onClick={handleDownload} disabled={isDownloading}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface disabled:opacity-50"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {isDownloading ? 'Downloading...' : 'Download ZIP'}
            </button>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...transitionDefault, delay: 0.05 }} className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Pricings', value: String(pricingsTotal || (d?.pricings?.length ?? 0)) },
            { label: 'Min price', value: d?.minPrice ? `$${d.minPrice.min.toFixed(2)} – $${d.minPrice.max.toFixed(2)}` : '—' },
            { label: 'Max price', value: d?.maxPrice ? `$${d.maxPrice.min.toFixed(2)} – $${d.maxPrice.max.toFixed(2)}` : '—' },
            { label: 'Config space', value: d?.configurationSpaceSize ? `${d.configurationSpaceSize.min.toLocaleString()} – ${d.configurationSpaceSize.max.toLocaleString()}` : '—' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-3">
              <p className="text-[11px] text-tp-steel">{s.label}</p>
              <p className="mt-0.5 truncate text-lg font-semibold text-tp-ink">{s.value}</p>
            </div>
          ))}
        </motion.div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 border-b border-tp-hairline-soft">
          {availableTabs.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`relative cursor-pointer px-4 py-2.5 text-sm font-medium transition-colors ${tab === key ? 'text-tp-primary' : 'text-tp-steel hover:text-tp-ink'}`}>
              {label}
              {tab === key && <motion.div layoutId="collection-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-tp-primary" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* PRICINGS TAB */}
          {tab === 'pricings' && (
            <motion.div key="pricings" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-medium text-tp-ink">
                  {isLoadingPricings ? 'Loading...' : `${pricingsTotal} ${pricingsTotal === 1 ? 'pricing' : 'pricings'} in collection`}
                </h2>
                <button
                  type="button" onClick={handleSortToggle}
                  className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13-6.75L16.5 19m0 0L12 14.5m4.5 4.5V10.5" />
                  </svg>
                  {sortAsc ? 'A→Z' : 'Z→A'}
                </button>
              </div>

              {isLoadingPricings ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: PRICINGS_PER_PAGE }).map((_, i) => (
                    <Skeleton key={i} height={128} />
                  ))}
                </div>
              ) : pricings.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline-soft bg-tp-canvas py-16 text-center">
                  <p className="text-sm font-medium text-tp-ink">No pricings in this collection</p>
                </div>
              ) : (
                <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pricings.map((p) => (
                    <motion.div key={`${p.organization.name}-${p.name}`} variants={fadeInUp} transition={transitionDefault}>
                      <PricingCard data={p} onRemoved={fetchPricings} />
                    </motion.div>
                  ))}
                </motion.div>
              )}

              {/* Pagination */}
              <div className="mt-6">
                <Pagination currentPage={pricingsPage} totalPages={pricingsTotalPages} onPageChange={setPricingsPage} />
              </div>
            </motion.div>
          )}

          {/* ANALYTICS TAB */}
          {tab === 'analytics' && (
            <motion.div key="analytics" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium text-tp-ink">Analytics</h3>
                <DatePicker dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
              </div>

              {analytics && (chartData.length > 0 || pricings.length > 0) ? (
                <>
                  {/* Summary stats */}
                  {pricings.length > 0 && (
                    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-3">
                        <p className="text-[11px] text-tp-steel">Avg min price</p>
                        <p className="mt-0.5 text-lg font-semibold text-tp-ink">${avgPrices.avgMin.toFixed(2)}</p>
                      </div>
                      <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-3">
                        <p className="text-[11px] text-tp-steel">Avg max price</p>
                        <p className="mt-0.5 text-lg font-semibold text-tp-ink">${avgPrices.avgMax.toFixed(2)}</p>
                      </div>
                      <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-3">
                        <p className="text-[11px] text-tp-steel">Pricings</p>
                        <p className="mt-0.5 text-lg font-semibold text-tp-ink">{pricingsTotal}</p>
                      </div>
                    </div>
                  )}

                  {/* Evolution charts */}
                  {chartData.length > 0 && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {([
                        ['configSpace', 'Configuration Space', '#08aeb3'],
                        ['plans', 'Plans', '#7c3aed'],
                        ['features', 'Features', '#0891b2'],
                        ['addOns', 'Add-ons', '#16a34a'],
                      ] as const).map(([k, label, color]) => (
                        <div key={k} className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4">
                          <div className="mb-2 flex items-center justify-center gap-2 text-[11px] text-tp-ink">
                            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
                            {label}
                          </div>
                          <ResponsiveContainer width="100%" height={220}>
                            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -8, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#ededed" />
                              <XAxis dataKey="date" tick={axisTick} />
                              <YAxis tick={axisTick} tickFormatter={fmtY} width={50} domain={['auto', 'auto']} />
                              <Tooltip />
                              <Line type="monotone" dataKey={k} stroke={color} strokeWidth={2} dot={{ r: 2 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline-soft bg-tp-canvas py-16 text-center">
                  <p className="text-sm text-tp-steel">No analytics data available for this collection.</p>
                </div>
              )}
            </motion.div>
          )}

          {/* SETTINGS TAB */}
          {tab === 'settings' && collection && (
            <motion.div key="settings" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transitionDefault}>
              <CollectionSettings
                collection={collection}
                permissions={permissions}
                onCollectionUpdated={handleCollectionUpdated}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
