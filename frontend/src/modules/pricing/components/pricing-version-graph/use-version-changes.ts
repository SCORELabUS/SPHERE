import { useEffect, useRef, useState } from 'react';
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
export function useVersionChanges(target: ChangesTarget | null): ChangesState {
  const { authUser } = useAuth();
  const token = authUser?.token;
  const files = useRef(new Map<string, Promise<unknown>>());
  const summaries = useRef(new Map<string, ChangeSummary>());
  const [state, setState] = useState<{ key: string; value: ChangesState } | null>(null);

  useEffect(() => {
    if (!target) return;
    const cached = summaries.current.get(target.key);
    if (cached) {
      setState({ key: target.key, value: { status: 'ready', summary: cached } });
      return;
    }

    const read = (yaml: string) => {
      const url = versionYamlUrl(yaml);
      let file = files.current.get(url);
      if (!file) {
        file = fetch(url, pricingYamlRequestInit(url, token))
          .then(response => {
            if (!response.ok) throw new Error(`Could not read ${url}`);
            return response.text();
          })
          .then(text => jsYaml.load(text));
        // A failed read is tried again the next time.
        file.catch(() => files.current.delete(url));
        files.current.set(url, file);
      }
      return file;
    };

    let active = true;
    const timer = window.setTimeout(() => {
      setState({ key: target.key, value: { status: 'loading' } });
      Promise.all([target.before ? read(target.before) : Promise.resolve({}), read(target.after)])
        .then(([before, after]) => {
          const summary = summarizeChanges(diffPricings(before, after));
          summaries.current.set(target.key, summary);
          if (active) setState({ key: target.key, value: { status: 'ready', summary } });
        })
        .catch(() => {
          if (active) setState({ key: target.key, value: { status: 'error' } });
        });
    }, HOVER_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [target?.key, target?.before, target?.after, token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return { status: 'idle' };
  return state?.key === target.key ? state.value : { status: 'loading' };
}
