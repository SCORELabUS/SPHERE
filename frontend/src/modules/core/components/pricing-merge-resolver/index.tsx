import { useEffect, useRef, useState } from 'react';
import type { IconType } from 'react-icons';
import { FiAlertTriangle, FiCode, FiColumns, FiGrid, FiInfo, FiList } from 'react-icons/fi';
import FileDiffView from '../../../pricing/components/pricing-version-diff/file-diff-view';
import type { PullRequestVersionRef, PullRequestWarning } from '../../../pricing/types/pull-requests';
import type { MergeResolver } from '../../hooks/useMergeResolver';
import ConflictList from './conflict-list';
import YamlResultEditor from './yaml-result-editor';
import VisualConflicts from './visual-conflicts';

type ResolverView = 'conflicts' | 'yaml' | 'compare' | 'visual';

const VIEWS: { view: ResolverView; label: string; icon: IconType }[] = [
  { view: 'conflicts', label: 'Conflicts', icon: FiList },
  { view: 'yaml', label: 'YAML', icon: FiCode },
  { view: 'compare', label: 'Compare', icon: FiColumns },
  { view: 'visual', label: 'Visual', icon: FiGrid },
];

/** What SPHERE did, or will do, to the result, in words. */
function warningMessage(warning: PullRequestWarning): string {
  switch (warning.code) {
    case 'SYNTAX_UPGRADED':
      return 'Some of these pricings were written in an older Pricing2Yaml syntax: SPHERE compares them, and writes the result, in the latest one.';
    case 'FORMAT_REGENERATED':
      return 'The result combines both sides, so SPHERE writes its YAML again: comments and the original layout are not kept.';
    case 'MANUAL_OVERRIDE':
      return 'The result was edited by hand: it replaces the computed merge.';
    case 'GLOBAL_FIELD_CHANGED':
      return `The current version changed ${warning.fields.join(', ')} and the proposal changes prices: check that they still mean what the proposal intended.`;
    case 'PREVIOUSLY_MERGED':
      return `Pull request #${warning.number} from this fork was merged before.`;
  }
}

function Warnings({ resolver }: { resolver: MergeResolver }) {
  const warnings: PullRequestWarning[] = [...(resolver.preview?.warnings ?? [])];
  if (resolver.state.manualYaml !== null && !warnings.some(warning => warning.code === 'MANUAL_OVERRIDE')) {
    warnings.push({ code: 'MANUAL_OVERRIDE' });
  }
  if (warnings.length === 0) return null;
  return (
    <ul aria-label="Notices about the result" className="space-y-1.5">
      {warnings.map(warning => (
        <li
          key={warning.code}
          data-warning={warning.code}
          className="flex items-start gap-2 rounded-lg border border-tp-severity-info-border bg-tp-severity-info-bg px-3 py-2 text-xs text-tp-ink"
        >
          <FiInfo aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tp-severity-info" />
          <span>{warningMessage(warning)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The Compare view: the version the result would follow against the result, line by line. */
function CompareView({
  resolver,
  loadLatestYaml,
}: {
  resolver: MergeResolver;
  loadLatestYaml: (target: PullRequestVersionRef) => Promise<string>;
}) {
  const target = resolver.preview!.target;
  const [latest, setLatest] = useState<{ id: string; yaml?: string; error?: string } | null>(null);
  const load = useRef(loadLatestYaml);
  load.current = loadLatestYaml;

  // The YAML of a version never changes, so it is read again only for another version.
  useEffect(() => {
    let active = true;
    load
      .current({ id: target.id, version: target.version })
      .then(yaml => {
        if (active) setLatest({ id: target.id, yaml });
      })
      .catch((caught: unknown) => {
        if (active) {
          setLatest({ id: target.id, error: caught instanceof Error ? caught.message : 'The version could not be read.' });
        }
      });
    return () => {
      active = false;
    };
  }, [target.id, target.version]);

  if (latest?.id !== target.id) {
    return (
      <div className="rounded-xl border border-dashed border-tp-hairline-strong px-4 py-8 text-center text-sm text-tp-slate">
        Reading version {target.version}…
      </div>
    );
  }
  if (latest.yaml === undefined) {
    return (
      <div role="alert" className="rounded-xl border border-tp-severity-error-border bg-tp-severity-error-bg px-4 py-3 text-sm text-tp-ink">
        Version {target.version} could not be read: {latest.error}
      </div>
    );
  }
  return (
    <FileDiffView
      before={latest.yaml}
      after={resolver.resultYaml}
      beforeLabel={`Version ${target.version}`}
      afterLabel="Result"
      markers
    />
  );
}

/**
 * Resolves a three-way merge of a pricing: the conflicts with their choices,
 * the result as YAML (which can be edited by hand), the result compared with
 * the version it would follow, and the result laid out like the visual editor.
 * The four views share the choices of `resolver`; the result and whether it is
 * valid always come from the server's preview.
 */
export default function PricingMergeResolver({
  resolver,
  loadLatestYaml,
}: {
  resolver: MergeResolver;
  /** Reads the YAML of the version the proposal is merged into, for the Compare view. */
  loadLatestYaml: (target: PullRequestVersionRef) => Promise<string>;
}) {
  const [view, setView] = useState<ResolverView>('conflicts');
  const { preview, state, unresolved, error } = resolver;

  if (!preview) {
    return error ? (
      <div role="alert" className="rounded-xl border border-tp-severity-error-border bg-tp-severity-error-bg px-4 py-3 text-sm text-tp-ink">
        {error}
      </div>
    ) : (
      <div className="rounded-xl border border-dashed border-tp-hairline-strong px-4 py-10 text-center text-sm text-tp-slate">
        Computing the merge…
      </div>
    );
  }

  const total = state.conflicts.length;
  const currentLabel = preview.target.version;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Resolver view" className="flex flex-wrap gap-1 rounded-xl bg-tp-surface p-1">
          {VIEWS.map(({ view: option, label, icon: Icon }) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all ${
                view === option
                  ? 'border-tp-primary/30 bg-tp-canvas text-tp-ink shadow-sm'
                  : 'border-transparent text-tp-steel hover:text-tp-ink'
              }`}
            >
              <Icon aria-hidden="true" className={`h-4 w-4 ${view === option ? 'text-tp-primary' : ''}`} />
              {label}
            </button>
          ))}
        </div>
        <p aria-live="polite" className="inline-flex items-center gap-1.5 text-xs font-medium text-tp-slate">
          {total === 0 ? (
            'No conflicts'
          ) : (
            <>
              {unresolved > 0 && <FiAlertTriangle aria-hidden="true" className="h-3.5 w-3.5 text-tp-severity-warning" />}
              {total} {total === 1 ? 'conflict' : 'conflicts'} · {unresolved} unresolved
            </>
          )}
        </p>
      </div>

      <p className="text-xs text-tp-steel">
        Merging into version {preview.target.version}, from the base version {preview.base.version}.
      </p>

      <Warnings resolver={resolver} />

      {error && (
        <div role="alert" className="rounded-xl border border-tp-severity-error-border bg-tp-severity-error-bg px-4 py-3 text-sm text-tp-ink">
          {error}
        </div>
      )}

      {view === 'conflicts' && <ConflictList resolver={resolver} currentLabel={currentLabel} />}
      {view === 'yaml' && <YamlResultEditor resolver={resolver} />}
      {view === 'compare' && <CompareView resolver={resolver} loadLatestYaml={loadLatestYaml} />}
      {view === 'visual' && (
        <VisualConflicts resolver={resolver} currentLabel={currentLabel} onShowYaml={() => setView('yaml')} />
      )}
    </div>
  );
}
