import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import type { Pricing } from 'pricing4ts';
import PricingCardOverview from '../../components/pricing-card-overview';
import PricingCardTabs from '../../components/pricing-card-tabs';
import PricingVersionsTab from '../../components/pricing-versions-tab';
import PricingAnalyticsTab from '../../components/pricing-analytics-tab';
import { ConfigurationExplorer } from '../../components/configuration-space-view';
import RobotsMeta from '../../components/robots-meta';
import { AnonymousPricingError, anonymousYamlUrl, fetchAnonymousPricing } from '../../api/anonymousLinksApi';
import { applyVariablesToYaml, parsePricingText } from '../../utils/pricing-text';
import { hasAnalytics } from '../../../core/utils/pricing-analytics';
import type { AnonymousPricing } from '../../types/anonymous-links';
import type { Tab, TreeAnalytics, VersionData } from '../../types/card';

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: AnonymousPricing; pricing: Pricing | null; yaml: string; errors: string[] }
  | { status: 'unavailable' }
  | { status: 'rate-limited'; retryAfter?: number }
  | { status: 'error' };

const formatPrice = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : '—');

/**
 * What an anonymous link shows (`/a/:token`): one or all visible versions of a pricing and
 * nothing about who published it. It lives outside the app layout, asks the
 * API only for this token (without credentials or Referer), keeps nothing in
 * the recent items and never navigates elsewhere, so its URL stays the link.
 */
export default function AnonymousPricingPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('overview');
  const [selectedVersion, setSelectedVersion] = useState<string>();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const loadConfigurations = useCallback(async (limit: number, offset: number) => {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (selectedVersion) query.set('version', selectedVersion);
    const response = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/anonymous-pricings/${encodeURIComponent(token)}/configuration-space?${query}`, {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not load configuration space');
    return body;
  }, [token, selectedVersion]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchAnonymousPricing(token, controller.signal, selectedVersion)
      .then(async data => {
        let pricing: Pricing | null = null;
        let errors: string[] = [];
        try {
          pricing = await parsePricingText(data.yaml);
        } catch (failure) {
          errors = [(failure as Error).message];
        }
        if (!controller.signal.aborted) setState({ status: 'ready', data, pricing, yaml: data.yaml, errors });
      })
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure instanceof AnonymousPricingError && failure.status === 404) setState({ status: 'unavailable' });
        else if (failure instanceof AnonymousPricingError && failure.status === 429) setState({ status: 'rate-limited', retryAfter: failure.retryAfter });
        else setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [token, attempt, selectedVersion]);

  const applyVariables = useCallback(async (variables: Record<string, unknown>) => {
    if (state.status !== 'ready') return;
    const yaml = applyVariablesToYaml(state.yaml, variables);
    try {
      setState({ ...state, yaml, pricing: await parsePricingText(yaml), errors: [] });
    } catch (failure) {
      setState({ ...state, yaml, errors: [(failure as Error).message] });
    }
  }, [state]);

  const analytics = state.status === 'ready' && hasAnalytics(state.data.analytics) ? state.data.analytics : null;
  const tree = useMemo(
    () => (analytics
      ? (Object.fromEntries(Object.entries(analytics).map(([key, value]) => [key, typeof value === 'number' ? value : 0])) as unknown as TreeAnalytics)
      : null),
    [analytics]
  );

  return (
    <div className="flex min-h-dvh flex-col bg-tp-canvas text-tp-ink">
      <Helmet>
        <title>Anonymous pricing · SPHERE</title>
      </Helmet>
      <RobotsMeta nofollow noReferrer />
      <header className="border-b border-tp-hairline">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <a href="/" rel="noreferrer" className="cursor-pointer font-display text-lg font-semibold text-tp-ink">
            SPHERE
          </a>
          <span className="rounded-full bg-tp-surface px-2.5 py-0.5 text-[11px] font-medium text-tp-steel">
            Anonymous pricing
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">
        {state.status === 'loading' && (
          <div className="flex h-64 items-center justify-center" aria-busy="true">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-tp-hairline border-t-tp-primary" />
          </div>
        )}

        {state.status === 'unavailable' && (
          <p role="status" className="py-24 text-center text-sm text-tp-steel">
            This link is not available
          </p>
        )}

        {(state.status === 'rate-limited' || state.status === 'error') && (
          <div role="status" className="flex flex-col items-center gap-3 py-24 text-center text-sm text-tp-steel">
            <p>
              {state.status === 'rate-limited'
                ? `Too many requests. Try again${state.retryAfter ? ` in ${state.retryAfter} seconds` : ' in a moment'}.`
                : 'The pricing could not be loaded.'}
            </p>
            <button
              type="button"
              onClick={() => setAttempt(value => value + 1)}
              className="cursor-pointer rounded-md border border-tp-hairline-strong px-3 py-1.5 text-xs font-medium text-tp-ink hover:bg-tp-surface"
            >
              Try again
            </button>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <h1 className="break-words font-display text-2xl font-normal text-tp-ink">
                  {state.pricing?.saasName || 'Pricing'}
                </h1>
                <p className="mt-1 text-xs text-tp-steel">
                  Version {state.data.version} · Released {new Date(state.data.createdAt).toLocaleDateString()}
                </p>
              </div>
              <a
                href={anonymousYamlUrl(token, selectedVersion)}
                rel="noreferrer"
                referrerPolicy="no-referrer"
                download
                className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 self-start rounded-lg bg-orange-500 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-orange-600 sm:self-auto"
              >
                Download YAML
              </a>
            </div>

            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label: 'Configurations', value: analytics?.configurationSpaceSize?.toLocaleString() ?? '—' },
                { label: 'Min price', value: formatPrice(analytics?.minSubscriptionPrice) },
                { label: 'Max price', value: formatPrice(analytics?.maxSubscriptionPrice) },
              ].map(tile => (
                <div key={tile.label} className="rounded-xl border border-tp-hairline bg-tp-canvas p-3">
                  <p className="text-[11px] text-tp-steel">{tile.label}</p>
                  <p className="mt-0.5 text-lg font-semibold text-tp-ink">{tile.value}</p>
                </div>
              ))}
            </div>

            <PricingCardTabs tab={tab} setTab={setTab} showSettingsTab={false} showVersions={state.data.allVersions === true} />
            {tab === 'overview' && <PricingCardOverview pricing={state.pricing} errors={state.errors} handleApplyVariables={applyVariables} aSafe={tree} yamlText={state.yaml} hasVersion />}
            {tab === 'analytics' && <PricingAnalyticsTab
              singleVersion={!state.data.allVersions}
              chartData={(state.data.allVersions ? state.data.versions ?? [] : [state.data]).filter(v => hasAnalytics(v.analytics) && (!dateFrom || v.createdAt.slice(0, 10) >= dateFrom) && (!dateTo || v.createdAt.slice(0, 10) <= dateTo)).slice().reverse().map(v => ({
                date: new Date(v.createdAt).toLocaleDateString(), minPrice: v.analytics.minSubscriptionPrice ?? 0,
                maxPrice: v.analytics.maxSubscriptionPrice ?? 0, avgPrice: ((v.analytics.minSubscriptionPrice ?? 0) + (v.analytics.maxSubscriptionPrice ?? 0)) / 2,
                configs: v.analytics.configurationSpaceSize ?? 0, plans: v.analytics.numberOfPlans ?? 0,
                features: v.analytics.numberOfFeatures ?? 0, addOns: v.analytics.numberOfAddOns ?? 0, usageLimits: v.analytics.numberOfUsageLimits ?? 0,
              }))}
              emptyMessage={analytics ? undefined : 'Analytics are not available for this version.'}
              dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo}
            />}
            {tab === 'config-space' && ((analytics?.configurationSpaceSize ?? 0) > 2000
              ? <p className="rounded-xl border border-tp-hairline p-6 text-sm text-tp-steel">The explorer is only available for pricing with 2,000 configurations or fewer.</p>
              : <ConfigurationExplorer loadConfigurations={loadConfigurations} pageSize={2000} />)}
            {tab === 'versions' && state.data.allVersions && <PricingVersionsTab
              readOnly versions={(state.data.versions ?? []).map(v => ({ id: v.version, version: v.version, createdAt: v.createdAt, analytics: v.analytics, yaml: anonymousYamlUrl(token, v.version), private: false, collection: null, forkedFrom: null }))}
              currentVersion={{ id: state.data.version, version: state.data.version, createdAt: state.data.createdAt, analytics: state.data.analytics, yaml: '', private: false, collection: null, forkedFrom: null }}
              canDelete={false} canChangeVisibility={false} onSelect={(v: VersionData) => { setSelectedVersion(v.version); setTab('overview'); }}
              onDownload={() => {}} onOpenInEditor={() => {}} onCopyLink={() => {}} onDelete={() => {}} onToggleVisibility={() => {}} onViewOrigin={() => {}}
            />}
          </>
        )}
      </main>
    </div>
  );
}
