import { useEffect, useMemo, useState } from 'react';
import jsYaml from 'js-yaml';
import { useAuth } from '../../../auth/hooks/useAuth';
import { pricingYamlRequestInit } from '../../../core/utils/pricing-yaml';
import { diffPricings } from '../../utils/pricing-diff';
import { summarizeChanges, type ChangeSummary } from '../../utils/change-summary';
import { versionYamlUrl } from '../../utils/version-yaml';

/** Two versions to compare by their YAML; `before` is null for a pricing's first version. */
export interface ChangesTarget {
  key: string;
  before: string | null;
  after: string;
}

export type ChangesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; summary: ChangeSummary }
  | { status: 'error' };

/** A pointer that only passes over a dot loads nothing. */
const HOVER_DELAY_MS = 150;

/**
 * What a version changed from the one before it, read from both YAML files and
 * compared like the version comparison does. Files and summaries are kept, so
 * pointing at a version again answers at once.
 */
export function useVersionChanges(target: ChangesTarget | null, revision: object | null): ChangesState {
  const { authUser } = useAuth();
  const token = authUser?.token;
  // A graph refresh or a credential change starts a new cache. Old requests may
  // finish, but can neither populate the new cache nor display their old result.
  const cache = useMemo(() => ({
    token,
    revision,
    files: new Map<string, Promise<unknown>>(),
    summaries: new Map<string, ChangeSummary>(),
  }), [token, revision]);
  const key = target ? JSON.stringify([target.key, target.before, target.after]) : null;
  const [state, setState] = useState<{ cache: typeof cache; key: string; value: ChangesState } | null>(null);

  useEffect(() => {
    if (!target || key === null) return;
    const cached = cache.summaries.get(key);
    if (cached) {
      setState({ cache, key, value: { status: 'ready', summary: cached } });
      return;
    }

    const read = (yaml: string) => {
      const url = versionYamlUrl(yaml);
      let file = cache.files.get(url);
      if (!file) {
        file = fetch(url, pricingYamlRequestInit(url, token))
          .then(response => {
            if (!response.ok) throw new Error(`Could not read ${url}`);
            return response.text();
          })
          .then(text => jsYaml.load(text));
        // A failed read is tried again the next time.
        file.catch(() => cache.files.delete(url));
        cache.files.set(url, file);
      }
      return file;
    };

    let active = true;
    const timer = window.setTimeout(() => {
      setState({ cache, key, value: { status: 'loading' } });
      Promise.all([target.before ? read(target.before) : Promise.resolve({}), read(target.after)])
        .then(([before, after]) => {
          const summary = summarizeChanges(diffPricings(before, after));
          cache.summaries.set(key, summary);
          if (active) setState({ cache, key, value: { status: 'ready', summary } });
        })
        .catch(() => {
          if (active) setState({ cache, key, value: { status: 'error' } });
        });
    }, HOVER_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [key, cache]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return { status: 'idle' };
  return state?.cache === cache && state.key === key ? state.value : { status: 'loading' };
}
