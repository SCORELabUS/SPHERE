import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { selectionFromSearchParams, selectionToSearchParams } from 'pricing-renderer';
import type { NormalizedPricing, PricingSelection } from 'pricing-renderer';
import { usePricingsApi } from '../../api/pricingsApi';
import BanterLoader from '../../../core/components/loaders/banter-loader';
import ConfigurationPicker from './configuration-picker';
import ConfigurationComparison from './configuration-comparison';
import CompareTray from './compare-tray';
import { captureLabel, nextSlot, type CompareSide, type CompareSlots } from './compare-slots';
import { completeSelectionForConfiguration, selectedAddOnIds } from './selection-mapping';
import type { SpherePricingSource } from '../../../core/components/pricing-renderer';

export interface Configuration {
  selectedPlan?: string;
  selectedAddons: string[];
  subscriptionFeatures: string[];
  subscriptionUsageLimits: string[];
}

type IndexedConfiguration = Configuration & { id: string };

function normalizeConfiguration(input: Partial<Configuration>): Configuration {
  return {
    selectedPlan: input.selectedPlan,
    selectedAddons: Array.isArray(input.selectedAddons) ? input.selectedAddons : [],
    subscriptionFeatures: Array.isArray(input.subscriptionFeatures) ? input.subscriptionFeatures : [],
    subscriptionUsageLimits: Array.isArray(input.subscriptionUsageLimits) ? input.subscriptionUsageLimits : [],
  };
}

function summarizeConfiguration(c: IndexedConfiguration, i: number) {
  return { index: i + 1, plan: c.selectedPlan || 'No plan', addOns: c.selectedAddons.length, features: c.subscriptionFeatures.length, limits: c.subscriptionUsageLimits.length };
}

const PAGE_SIZE = 200;
const BATCH = 120;

export default function ConfigurationSpaceView({ organizationId, pricingSlug, pricingVersion, source }: { organizationId: string; pricingSlug: string; pricingVersion: string; source?: SpherePricingSource }) {
  const [allConfigs, setAllConfigs] = useState<IndexedConfiguration[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('All plans');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(BATCH);
  // The renderer's state, lifted: the tab needs the normalized pricing to turn a configuration
  // into a selection, and the live selection to hold it for comparison.
  const [rendererState, setRendererState] = useState<{ pricing: NormalizedPricing; selection: PricingSelection }>();
  const [slots, setSlots] = useState<CompareSlots>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const restoredRef = useRef(false);
  const { getConfigurationSpace } = usePricingsApi();
  const loaderRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  const plans = useMemo(() => {
    const s = new Set<string>();
    allConfigs.forEach(c => { if (c.selectedPlan) s.add(c.selectedPlan); });
    return ['All plans', 'No plan', ...Array.from(s).sort()];
  }, [allConfigs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allConfigs.filter(c => {
      const planOk = planFilter === 'All plans' || (planFilter === 'No plan' ? !c.selectedPlan : c.selectedPlan === planFilter);
      if (!q) return planOk;
      const txt = [c.selectedPlan || '', ...c.selectedAddons, ...c.subscriptionFeatures, ...c.subscriptionUsageLimits].join(' ').toLowerCase();
      return planOk && txt.includes(q);
    });
  }, [allConfigs, search, planFilter]);

  const activeIdx = useMemo(() => filtered.findIndex(c => c.id === focusedId), [filtered, focusedId]);
  const focused = useMemo(() => filtered.find(c => c.id === focusedId), [filtered, focusedId]);

  useEffect(() => {
    let canceled = false;
    idRef.current = 0;
    setAllConfigs([]); setTotalSize(0); setVisibleCount(BATCH); setLoadError(null);
    const load = async () => {
      try {
        const all: IndexedConfiguration[] = [];
        let total = 0, offset = 0, keep = true;
        while (keep && !canceled) {
          const res = await getConfigurationSpace(organizationId, pricingSlug, pricingVersion, PAGE_SIZE, offset);
          const chunk = (res?.configurationSpace as Partial<Configuration>[] | undefined) ?? [];
          if (offset === 0) { total = Number(res?.configurationSpaceSize ?? chunk.length); setTotalSize(total); }
          all.push(...chunk.map(c => ({ ...normalizeConfiguration(c), id: `cfg-${idRef.current++}` })));
          if (chunk.length === 0 || (total > 0 && all.length >= total)) keep = false;
          else offset += PAGE_SIZE;
        }
        if (!canceled) { setAllConfigs(all); if (total === 0) setTotalSize(all.length); }
      } catch { if (!canceled) setLoadError('The configuration space could not be loaded. This may happen when the pricing is too complex. Try simplifying the pricing structure or reducing the number of plans, add-ons, features, or usage limits.'); }
      finally { if (!canceled) setLoading(false); }
    };
    load();
    return () => { canceled = true; };
  }, [organizationId, pricingSlug, pricingVersion]);

  useEffect(() => {
    if (filtered.length === 0) { setFocusedId(null); return; }
    if (!focusedId || !filtered.some(c => c.id === focusedId)) setFocusedId(filtered[0].id);
  }, [filtered, focusedId]);

  useEffect(() => { setVisibleCount(p => Math.min(Math.max(BATCH, p), filtered.length)); }, [filtered.length]);

  // --- holding configurations for comparison ------------------------------------------------
  // Both slots live in the query string, so a comparison is a link. Writing uses `replace` so the
  // back button still leaves the tab rather than stepping through every capture.
  //
  // Both sides are written in one pass from the next state, through the functional form of
  // setSearchParams. Writing them one side at a time from the `searchParams` of this render meant
  // the second write started from the params the first had not yet produced, so clearing both left
  // A behind and swapping wrote one side twice.
  const applySlots = useCallback(
    (next: CompareSlots) => {
      setSlots(next);
      setSearchParams(
        prev => {
          const params = new URLSearchParams(prev);
          for (const side of ['a', 'b'] as const) {
            const prefix = `cfg${side.toUpperCase()}.`;
            for (const key of [...params.keys()]) if (key.startsWith(prefix)) params.delete(key);
            const held = next[side];
            if (held) {
              for (const [k, v] of selectionToSearchParams(held, { prefix })) params.append(k, v);
            }
          }
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const hold = useCallback(
    (selection: PricingSelection | undefined) => {
      if (!selection) return;
      applySlots({ ...slots, [nextSlot(slots)]: selection });
    },
    [slots, applySlots]
  );

  const clearSlots = useCallback(
    (side?: CompareSide) => {
      applySlots(side ? { ...slots, [side]: undefined } : {});
    },
    [slots, applySlots]
  );

  // Computed before the setters run, never inside a state updater: React may call an updater
  // during render, and navigating from there updates the router while this component renders.
  const swapSlots = useCallback(() => {
    applySlots({ a: slots.b, b: slots.a });
  }, [slots, applySlots]);

  // A link someone was given: read both sides back once the pricing is known. A side with no keys
  // was never captured -- selectionFromSearchParams would otherwise return the schema defaults and
  // invent one.
  useEffect(() => {
    const pricing = rendererState?.pricing;
    if (!pricing || restoredRef.current) return;
    restoredRef.current = true;
    const entries = [...searchParams.entries()];
    const restored: CompareSlots = {};
    for (const side of ['a', 'b'] as const) {
      const prefix = `cfg${side.toUpperCase()}.`;
      if (!entries.some(([key]) => key.startsWith(prefix))) continue;
      restored[side] = selectionFromSearchParams(pricing, entries, { prefix }).selection;
    }
    if (restored.a || restored.b) setSlots(restored);
  }, [rendererState?.pricing, searchParams]);

  const identicalSlots = useMemo(() => {
    if (!slots.a || !slots.b) return false;
    if ((slots.a.planId ?? '') !== (slots.b.planId ?? '')) return false;
    const x = selectedAddOnIds(slots.a);
    const y = selectedAddOnIds(slots.b);
    return x.length === y.length && x.every((id, i) => id === y[i]);
  }, [slots]);

  const quickItems = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = visibleCount < filtered.length;

  useEffect(() => {
    if (!loaderRef.current) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting && !loading && hasMore) setVisibleCount(p => Math.min(p + BATCH, filtered.length)); }, { rootMargin: '200px' });
    obs.observe(loaderRef.current);
    return () => obs.disconnect();
  }, [filtered.length, hasMore, loading]);

  if (loading) return <div className="mt-10 flex justify-center"><BanterLoader /></div>;

  if (loadError) return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline bg-tp-canvas py-16 text-center">
      <svg className="mb-3 h-10 w-10 text-tp-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
      <p className="text-sm font-medium text-tp-ink">Could not load configuration space</p>
      <p className="mt-1 w-full max-w-125 text-xs text-tp-steel">{loadError}</p>
    </div>
  );

  return (
    <div className="mx-auto flex w-full flex-col gap-4">
      {/* Kept at the top so the mechanism is visible before anyone scrolls. */}
      {source && (
        <CompareTray slots={slots} onClear={clearSlots} onSwap={swapSlots} identical={identicalSlots} />
      )}

      {source && rendererState && slots.a && slots.b && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-tp-hairline bg-tp-canvas p-4"
        >
          <h2 className="mb-2 text-lg font-semibold text-tp-ink">A compared with B</h2>
          <ConfigurationComparison pricing={rendererState.pricing} a={slots.a} b={slots.b} />
        </motion.div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        {/* Explorer */}
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="rounded-xl border border-tp-hairline bg-tp-canvas p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-tp-ink">Configuration Explorer</h2>
              <p className="text-xs text-tp-steel">Navigate through all possible configurations.</p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-tp-steel">
              <span className="rounded-full bg-tp-surface px-2 py-0.5">Loaded {allConfigs.length.toLocaleString()}</span>
              <span className="rounded-full bg-tp-surface px-2 py-0.5">Total {totalSize.toLocaleString()}</span>
              <span className="rounded-full bg-tp-primary/10 px-2 py-0.5 text-tp-primary">Visible {filtered.length.toLocaleString()}</span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_200px]">
            <div className="rounded-lg border border-tp-hairline-strong bg-tp-canvas p-3">
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-tp-steel">Search</label>
              <input className="w-full bg-transparent text-sm text-tp-ink outline-none placeholder-tp-muted" value={search} onChange={e => setSearch(e.target.value)} placeholder="Plan, add-on, feature, limit" />
            </div>
            <div className="rounded-lg border border-tp-hairline-strong bg-tp-canvas p-3">
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-tp-steel">Plan</label>
              <select value={planFilter} onChange={e => setPlanFilter(e.target.value)} className="w-full cursor-pointer bg-transparent text-sm text-tp-ink outline-none">
                {plans.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-tp-hairline bg-tp-surface p-4">
            <AnimatePresence mode="wait">
              {focused ? (
                <motion.div key={focused.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><p className="text-[10px] font-medium uppercase tracking-wider text-tp-steel">Current selection</p><h3 className="mt-0.5 text-base font-semibold text-tp-ink">{focused.selectedPlan || 'No plan'}</h3></div>
                    <span className="rounded-full bg-tp-canvas px-2 py-0.5 text-[11px] text-tp-steel border border-tp-hairline">#{Math.max(activeIdx + 1, 0)} of {filtered.length.toLocaleString()}</span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {[['Add-ons', focused.selectedAddons.length], ['Features', focused.subscriptionFeatures.length], ['Limits', focused.subscriptionUsageLimits.length]].map(([l, n]) => (
                      <div key={l} className="rounded-lg bg-tp-canvas px-3 py-2 border border-tp-hairline"><p className="text-[11px] text-tp-steel">{l}</p><p className="text-sm font-semibold text-tp-ink">{n as number}</p></div>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg border border-dashed border-tp-hairline-strong p-6 text-center text-xs text-tp-muted">No configurations match this search.</motion.div>
              )}
            </AnimatePresence>
            <div className="mt-4 flex items-center gap-2">
              <button type="button" onClick={() => { if (activeIdx > 0) setFocusedId(filtered[activeIdx - 1].id); }} disabled={activeIdx <= 0} className="cursor-pointer flex items-center gap-1 rounded-md border border-tp-hairline-strong bg-tp-canvas px-3 py-1.5 text-xs text-tp-slate transition-colors hover:bg-tp-surface disabled:opacity-30">← Prev</button>
              <button type="button" onClick={() => { if (activeIdx < filtered.length - 1) setFocusedId(filtered[activeIdx + 1].id); }} disabled={activeIdx < 0 || activeIdx >= filtered.length - 1} className="cursor-pointer flex items-center gap-1 rounded-md border border-tp-hairline-strong bg-tp-canvas px-3 py-1.5 text-xs text-tp-slate transition-colors hover:bg-tp-surface disabled:opacity-30">Next →</button>
              <button type="button" onClick={() => { if (filtered.length > 0) setFocusedId(filtered[Math.floor(Math.random() * filtered.length)].id); }} disabled={filtered.length === 0} className="ml-auto cursor-pointer flex items-center gap-1 rounded-md bg-tp-primary px-3 py-1.5 text-xs font-medium text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:opacity-50">🎲 Surprise me</button>
            </div>

            {source && (
              <div className="mt-4 border-t border-tp-hairline pt-4">
                <ConfigurationPicker
                  source={source}
                  focused={focused}
                  configurations={filtered}
                  allConfigurations={allConfigs}
                  position={Math.max(activeIdx + 1, 0)}
                  onPick={setFocusedId}
                  onStateChange={setRendererState}
                  captureLabel={captureLabel(slots)}
                  onCapture={() => hold(rendererState?.selection)}
                />
              </div>
            )}
          </div>
        </motion.div>

        {/* Quick browse */}
        <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="rounded-xl border border-tp-hairline bg-tp-canvas p-3">
          <h3 className="text-xs font-medium text-tp-steel">Quick Browse</h3>
          <p className="mt-0.5 text-[11px] text-tp-muted">Scroll to load more configurations.</p>
          <div className="mt-3 max-h-[66vh] overflow-y-auto overscroll-contain pr-1">
            <div className="space-y-1.5">
              {quickItems.map((c, i) => {
                const s = summarizeConfiguration(c, i);
                const active = focusedId === c.id;
                return (
                  // A row is two actions: draw it in the pricing, or hold it for comparison. The
                  // second does not move the focus, so both slots can be filled from this list
                  // without a trip through the pricing each time.
                  <div key={c.id} className={`flex w-full items-center gap-1 rounded-lg border transition-colors ${active ? 'border-tp-primary bg-tp-primary/5' : 'border-tp-hairline bg-tp-canvas hover:bg-tp-surface'}`}>
                    <button type="button" onClick={() => setFocusedId(c.id)} className="min-w-0 flex-1 cursor-pointer px-3 py-2 text-left">
                      <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium text-tp-ink">{s.plan}</p><p className="shrink-0 text-[10px] text-tp-muted">#{s.index}</p></div>
                      <p className="mt-0.5 text-[11px] text-tp-steel">{s.addOns} add-ons · {s.features} features · {s.limits} limits</p>
                    </button>
                    {rendererState && (
                      <button
                        type="button"
                        onClick={() =>
                          hold(
                            completeSelectionForConfiguration(
                              rendererState.pricing,
                              c,
                              rendererState.selection
                            )
                          )
                        }
                        aria-label={`${captureLabel(slots)}: ${s.plan}`}
                        title={captureLabel(slots)}
                        className="mr-2 shrink-0 cursor-pointer rounded-md border border-tp-hairline-strong bg-tp-canvas px-2 py-1 text-[10px] font-medium text-tp-slate transition-colors hover:bg-tp-surface"
                      >
                        {slots.a && !slots.b ? 'vs A' : 'Compare'}
                      </button>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && <div className="rounded-lg border border-dashed border-tp-hairline-strong p-4 text-center text-[11px] text-tp-muted">No results.</div>}
            </div>
            <div ref={loaderRef} className="mt-4 flex min-h-8 items-center justify-center">
              <p className="text-[11px] text-tp-muted">{hasMore ? 'Scroll to load more' : 'All visible'}</p>
            </div>
          </div>
        </motion.div>
      </div>

    </div>
  );
}
