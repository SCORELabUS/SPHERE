import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { IconType } from 'react-icons';
import {
  FiAlertTriangle,
  FiCode,
  FiColumns,
  FiGrid,
  FiInfo,
  FiList,
  FiMaximize2,
  FiMinimize2,
  FiRefreshCw,
} from 'react-icons/fi';
import FileDiffView from '../../../pricing/components/pricing-version-diff/file-diff-view';
import type { PullRequestVersionRef, PullRequestWarning } from '../../../pricing/types/pull-requests';
import type { MergeResolver } from '../../hooks/useMergeResolver';
import { pullRequestWarningMessage, textsToCompare } from '../../utils/pull-request-state';
import FormatNote from '../format-note';
import ConflictList from './conflict-list';
import FullWindowLayer from './full-window';
import VisualResult from './visual-result';
import YamlResultView from './yaml-result-view';

export type ResolverView = 'conflicts' | 'yaml' | 'compare' | 'visual';

const VIEWS: { view: ResolverView; label: string; icon: IconType }[] = [
  { view: 'conflicts', label: 'Conflicts', icon: FiList },
  { view: 'yaml', label: 'YAML', icon: FiCode },
  { view: 'compare', label: 'Compare', icon: FiColumns },
  { view: 'visual', label: 'Visual', icon: FiGrid },
];

/** Who is using the resolver, which says what it combines. */
export type ResolverPurpose = 'merge' | 'update' | 'propose';

/** What a merge or an update combines; a proposal from a fork says it in its own dialog. */
function summaryOf(purpose: ResolverPurpose, target: string, base: string): string | null {
  switch (purpose) {
    case 'merge':
      return `Merging into version ${target}, from the base version ${base}.`;
    case 'update':
      return `Bringing your proposal up to version ${target}, from the base version ${base}.`;
    case 'propose':
      return null;
  }
}

/** The server's notices about the result, which every view takes (and a merge or an update shows before it is confirmed). */
export function Warnings({ resolver }: { resolver: MergeResolver }) {
  const warnings: PullRequestWarning[] = resolver.preview?.warnings ?? [];
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
          <span>{pullRequestWarningMessage(warning)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Why the preview failed, with a way to ask for it again (after too many requests it also retries by itself). */
export function PreviewError({ resolver }: { resolver: MergeResolver }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-tp-severity-error-border bg-tp-severity-error-bg px-4 py-3 text-sm text-tp-ink"
    >
      <span className="min-w-0">{resolver.error}</span>
      <button
        type="button"
        onClick={resolver.retry}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-2.5 py-1 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
      >
        <FiRefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
        {resolver.retryIn !== null ? 'Try again now' : 'Try again'}
      </button>
    </div>
  );
}

/**
 * The Compare view: the version the result would follow against the result,
 * line by line. When the two are written in different syntaxes, both are
 * compared as the server sends them, so the syntax is not shown as a change;
 * when they are formatted differently, both are shown in one format
 * (`textsToCompare`), so quotes or line breaks are not shown as changes.
 */
function CompareView({
  resolver,
  loadLatestYaml,
}: {
  resolver: MergeResolver;
  loadLatestYaml: (target: PullRequestVersionRef) => Promise<string>;
}) {
  const { target, targetNormalizedYaml, resultNormalizedYaml } = resolver.preview!;
  const [latest, setLatest] = useState<{ id: string; yaml?: string; error?: string } | null>(null);
  const load = useRef(loadLatestYaml);
  load.current = loadLatestYaml;

  const hasNormalizedTarget = targetNormalizedYaml !== undefined;

  // The YAML of a version never changes, so it is read again only for another version
  // (and not at all when the server sent it upgraded).
  useEffect(() => {
    if (hasNormalizedTarget) return;
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
  }, [target.id, target.version, hasNormalizedTarget]);

  const before = targetNormalizedYaml ?? (latest?.id === target.id ? latest.yaml : undefined);
  // A result typed by hand is compared as typed: the server's normalized text is the computed one's.
  const resultNormalized = resolver.isManual ? undefined : resultNormalizedYaml;
  const after = resultNormalized ?? resolver.resultYaml;
  const compared = useMemo(() => (before === undefined ? null : textsToCompare(before, after)), [before, after]);

  if (!hasNormalizedTarget && latest?.id !== target.id) {
    return (
      <div className="rounded-xl border border-dashed border-tp-hairline-strong px-4 py-8 text-center text-sm text-tp-slate">
        Reading version {target.version}…
      </div>
    );
  }
  if (compared === null) {
    return (
      <div role="alert" className="rounded-xl border border-tp-severity-error-border bg-tp-severity-error-bg px-4 py-3 text-sm text-tp-ink">
        Version {target.version} could not be read: {latest?.error}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {(targetNormalizedYaml !== undefined || resultNormalized !== undefined) && (
        <p className="text-xs text-tp-steel">
          Version {target.version} and the result are written in different Pricing2Yaml syntaxes. Both are compared in
          the latest syntax, so the syntax is not shown as a change.
        </p>
      )}
      {compared.reformatted && <FormatNote first={`Version ${target.version}`} second="the result" />}
      <FileDiffView
        before={compared.before}
        after={compared.after}
        beforeLabel={`Version ${target.version}`}
        afterLabel="Result"
        markers
      />
    </div>
  );
}

/**
 * Resolves a three-way merge of a pricing by choosing a side for each
 * conflict: the conflicts with their choices, the result as YAML, the result
 * compared with the version it would follow, and the result drawn as the
 * pricing's Overview draws it. The four views share the choices of `resolver`;
 * the result and whether it is valid come from the server's preview, unless the
 * resolver is editable and the result was typed by hand in the YAML view.
 *
 * With `fill`, the resolver takes the height its container gives it and the
 * views share one area that scrolls inside, so switching views never resizes
 * what holds it (a dialog). Each view fades in when it is picked.
 *
 * Expand shows the resolver over the whole window, above any dialog, with the
 * same view and choices; Collapse or Escape bring it back where it was. It is
 * not offered (`expandable`) where the resolver already has the whole window.
 */
export default function PricingMergeResolver({
  resolver,
  loadLatestYaml,
  purpose = 'merge',
  fill = false,
  expandable = true,
  initialView = 'conflicts',
}: {
  resolver: MergeResolver;
  /** Reads the YAML of the version the proposal is merged into, for the Compare view. */
  loadLatestYaml: (target: PullRequestVersionRef) => Promise<string>;
  /** A maintainer's merge, an author's update or a new proposal: the resolver words what it combines for each. */
  purpose?: ResolverPurpose;
  fill?: boolean;
  expandable?: boolean;
  /** The view it opens on. */
  initialView?: ResolverView;
}) {
  const [view, setView] = useState<ResolverView>(initialView);
  const [expanded, setExpanded] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  // The Expand button, or Collapse once expanded: the focus follows the resolver where it goes.
  const toggle = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);
  const { preview, state, unresolved, error } = resolver;

  // A view picked starts at its top, wherever the previous one was scrolled.
  useEffect(() => {
    if (stage.current) stage.current.scrollTop = 0;
  }, [view]);

  useEffect(() => {
    if (toggled.current) toggle.current?.focus();
  }, [expanded]);

  const setExpandedFromButton = (next: boolean) => {
    toggled.current = true;
    setExpanded(next);
  };

  if (!preview) {
    return error ? (
      <PreviewError resolver={resolver} />
    ) : (
      <div
        className={`flex items-center justify-center rounded-xl border border-dashed border-tp-hairline-strong px-4 py-10 text-center text-sm text-tp-slate ${
          fill ? 'h-full' : ''
        }`}
      >
        Computing the merge…
      </div>
    );
  }

  const total = state.conflicts.length;
  const currentLabel = preview.target.version;
  const summary = summaryOf(purpose, preview.target.version, preview.base.version);
  // Expanded, the views always fill the window.
  const filled = fill || expanded;

  const workspace = (
    <div className={filled ? 'flex h-full min-h-0 flex-col gap-4' : 'space-y-4'}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
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
        <div className="flex items-center gap-3">
          {/* Only conflicts are counted: with none, there is nothing to say. */}
          <p aria-live="polite" className="inline-flex items-center gap-1.5 text-xs font-medium text-tp-slate">
            {total > 0 && (
              <>
                {unresolved > 0 && <FiAlertTriangle aria-hidden="true" className="h-3.5 w-3.5 text-tp-severity-warning" />}
                {total} {total === 1 ? 'conflict' : 'conflicts'} · {unresolved} unresolved
              </>
            )}
          </p>
          {expandable && (
            <button
              ref={toggle}
              type="button"
              aria-pressed={expanded}
              title={expanded ? 'Back to its place (Esc)' : 'Show it over the whole window'}
              onClick={() => setExpandedFromButton(!expanded)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-2.5 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
            >
              {expanded ? (
                <FiMinimize2 aria-hidden="true" className="h-3.5 w-3.5" />
              ) : (
                <FiMaximize2 aria-hidden="true" className="h-3.5 w-3.5" />
              )}
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
      </div>

      {summary && <p className="shrink-0 text-xs text-tp-steel">{summary}</p>}

      <div className="shrink-0 empty:hidden">
        <Warnings resolver={resolver} />
      </div>

      {error && (
        <div className="shrink-0">
          <PreviewError resolver={resolver} />
        </div>
      )}

      <div ref={stage} className={filled ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain' : undefined}>
        <motion.div
          key={view}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={filled ? 'h-full' : undefined}
        >
          {view === 'conflicts' && <ConflictList resolver={resolver} currentLabel={currentLabel} />}
          {view === 'yaml' && <YamlResultView resolver={resolver} fill={filled} />}
          {view === 'compare' && <CompareView resolver={resolver} loadLatestYaml={loadLatestYaml} />}
          {view === 'visual' && (
            <VisualResult resolver={resolver} currentLabel={currentLabel} onShowYaml={() => setView('yaml')} />
          )}
        </motion.div>
      </div>
    </div>
  );

  if (!expanded) return workspace;

  // Where the resolver was, a placeholder of the same height keeps what holds it (a dialog) as it was.
  return (
    <>
      <div
        className={`flex items-center justify-center rounded-xl border border-dashed border-tp-hairline-strong px-4 py-10 text-center text-sm text-tp-slate ${
          fill ? 'h-full' : ''
        }`}
      >
        Shown over the whole window.
      </div>
      <FullWindowLayer label="Resolver, expanded" onClose={() => setExpandedFromButton(false)}>
        {workspace}
      </FullWindowLayer>
    </>
  );
}
