import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import type { Pricing } from 'pricing4ts';
import { PricingRenderer } from '../../../pricing-editor/components/pricing-renderer';
import PricingTree from '../../components/pricing-tree';
import YamlSourcePanel from '../../components/yaml-source-panel';
import RobotsMeta from '../../components/robots-meta';
import { AnonymousPricingError, anonymousYamlUrl, fetchAnonymousPricing } from '../../api/anonymousLinksApi';
import { applyVariablesToYaml, parsePricingText } from '../../utils/pricing-text';
import { hasAnalytics } from '../../../core/utils/pricing-analytics';
import type { AnonymousPricing } from '../../types/anonymous-links';
import type { TreeAnalytics } from '../../types/card';

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: AnonymousPricing; pricing: Pricing | null; yaml: string; errors: string[] }
  | { status: 'unavailable' }
  | { status: 'rate-limited'; retryAfter?: number }
  | { status: 'error' };

const formatPrice = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : '—');

/**
 * What an anonymous link shows (`/a/:token`): one version of a pricing and
 * nothing about who published it. It lives outside the app layout, asks the
 * API only for this token (without credentials or Referer), keeps nothing in
 * the recent items and never navigates elsewhere, so its URL stays the link.
 */
export default function AnonymousPricingPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchAnonymousPricing(token, controller.signal)
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
  }, [token, attempt]);

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
                href={anonymousYamlUrl(token)}
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

            <div className="flex flex-col gap-6 lg:flex-row">
              <section className="min-w-0 flex-1 rounded-xl border border-tp-hairline bg-tp-canvas p-4">
                {state.pricing ? (
                  <PricingRenderer pricing={state.pricing} errors={state.errors} onApplyVariables={applyVariables} />
                ) : (
                  <div className="flex h-64 items-center justify-center text-sm text-tp-steel">
                    Could not load pricing preview
                  </div>
                )}
              </section>
              <aside className="w-full space-y-4 lg:w-[360px] lg:shrink-0">
                {tree && <PricingTree analytics={tree} />}
                <YamlSourcePanel yamlText={state.yaml} />
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
