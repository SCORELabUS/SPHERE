import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { AnimatePresence } from 'framer-motion';
import jsYaml from 'js-yaml';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { FiArrowLeft, FiGitMerge } from 'react-icons/fi';
import { useAuth } from '../../../auth/hooks/useAuth';
import { PullRequestApiError, usePricingPullRequestsApi } from '../../api/pricingPullRequestsApi';
import {
  pullRequestAuthorName,
  pullRequestMessage,
  textsToCompare,
  withoutSyntaxDefaults,
} from '../../../core/utils/pull-request-state';
import FormatNote from '../../../core/components/format-note';
import { diffPricings, type ChangeKind } from '../../utils/pricing-diff';
import { DiffResult, ViewToggle, type ViewMode } from '../pricing-version-diff';
import FileDiffView from '../pricing-version-diff/file-diff-view';
import type { VersionData } from '../../types/card';
import type {
  PullRequestDetail as PullRequestDetailData,
  PullRequestMergeResult,
  PullRequestVersionRef,
} from '../../types/pull-requests';
import { usePageVersionYaml, VersionNotOnPage } from './use-page-version-yaml';
import StateChip from './state-chip';
import CloseDialog from './close-dialog';
import MergeBox from './merge-box';

const ago = (date: string) => `${formatDistanceToNow(parseISO(date))} ago`;

/**
 * Says that the two texts compared are written in different Pricing2Yaml
 * syntaxes: the server sends both as it compares them, so the syntax is not
 * shown as a change.
 */
function SyntaxNote({ first, second }: { first: string; second: string }) {
  return (
    <p className="mt-1 text-xs text-tp-steel">
      {first} and {second} are written in different Pricing2Yaml syntaxes. Both are compared in the latest syntax, so
      the syntax is not shown as a change.
    </p>
  );
}

/** The structured comparison, or null when either side is not a YAML mapping it can read. */
function structuredDiff(before: string, after: string) {
  try {
    // SPHERE sets the pricing's name when it merges, so a different `saasName` is not a change, and
    // values the latest syntax reads as absent are not one either.
    return diffPricings(withoutSyntaxDefaults(jsYaml.load(before)), withoutSyntaxDefaults(jsYaml.load(after)), {
      ignoreKeys: ['saasName'],
    });
  } catch {
    return null;
  }
}

/** Two texts compared, by structure or line by line. */
interface Compared {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
  /** `afterLabel` inside a sentence. */
  afterName: string;
}

/** What a merged pull request published or proposed; while it is open, what it proposes. */
type ChangesSource = 'published' | 'proposed';

const SOURCES: { source: ChangesSource; label: string }[] = [
  { source: 'published', label: 'Published' },
  { source: 'proposed', label: 'Proposed' },
];

function SourceToggle({ value, onChange }: { value: ChangesSource; onChange: (source: ChangesSource) => void }) {
  return (
    <div role="group" aria-label="Changes shown" className="inline-grid grid-cols-2 gap-1 rounded-xl bg-tp-surface p-1">
      {SOURCES.map(({ source, label }) => (
        <button
          key={source}
          type="button"
          aria-pressed={value === source}
          onClick={() => onChange(source)}
          className={`cursor-pointer rounded-lg border px-4 py-1.5 text-sm font-medium transition-all ${
            value === source
              ? 'border-tp-primary/30 bg-tp-canvas text-tp-ink shadow-sm'
              : 'border-transparent text-tp-steel hover:text-tp-ink'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const readError = (caught: unknown) => (caught instanceof Error ? caught.message : 'it could not be read.');

/** A version of the Published comparison that could not be read, and whether the page had not loaded it. */
class VersionReadError extends Error {
  readonly notOnPage: boolean;

  constructor(version: string, caught: unknown) {
    super(`Version ${version} could not be read: ${readError(caught)}`);
    this.notOnPage = caught instanceof VersionNotOnPage;
  }
}

/**
 * The changes of a pull request. While it is open (or closed) they are what it
 * proposes, compared with its base. Once merged, and when the caller may read
 * both versions, they are first what the merge published, compared with the
 * version it was merged on: the conflicts were resolved there, so it can differ
 * from the proposal, which stays one click away. Each text is shown as it is
 * written; when the two are in different syntaxes, the server sends both as it
 * compares them, and those are compared. Line by line, two texts formatted
 * differently are shown in one format (`textsToCompare`).
 */
function Changes({
  pullRequest,
  loadVersionYaml,
  awaitingPage,
}: {
  pullRequest: PullRequestDetailData;
  loadVersionYaml: (version: PullRequestVersionRef) => Promise<string>;
  /** Merged here: the page is loading its versions again, so one it lacks is still on its way. */
  awaitingPage: boolean;
}) {
  const { merged } = pullRequest;
  const mergedId = merged?.versionId;
  const mergedVersion = merged?.version;
  const followedId = merged?.followed?.versionId;
  const followedVersion = merged?.followed?.version;
  const followedNormalized = merged?.followed?.normalizedYaml;
  const mergedNormalized = merged?.normalizedYaml;
  const canShowPublished = Boolean(mergedId && mergedVersion !== undefined && followedId && followedVersion !== undefined);
  const [source, setSource] = useState<ChangesSource>(canShowPublished ? 'published' : 'proposed');
  const shownSource: ChangesSource = canShowPublished ? source : 'proposed';
  const publishedKey = canShowPublished ? `${followedId}:${mergedId}` : null;
  const [published, setPublished] = useState<{
    key: string;
    texts?: Compared;
    error?: VersionReadError;
    /** The reader that failed: the page reloads its versions after a merge, and the new reader tries again. */
    reader?: typeof loadVersionYaml;
  } | null>(null);
  // A version's text never changes: the pair already read is not read again.
  const loadedKey = useRef<string | null>(null);

  // Both versions are read from the page; a version it has not loaded yet is read again once it has.
  useEffect(() => {
    if (shownSource !== 'published' || !publishedKey || loadedKey.current === publishedKey) return;
    let active = true;
    const read = (id: string, version: string) =>
      loadVersionYaml({ id, version }).catch((caught: unknown) => {
        throw new VersionReadError(version, caught);
      });
    Promise.all([
      followedNormalized ?? read(followedId!, followedVersion!),
      mergedNormalized ?? read(mergedId!, mergedVersion!),
    ])
      .then(([before, after]) => {
        if (!active) return;
        loadedKey.current = publishedKey;
        setPublished({
          key: publishedKey,
          texts: {
            before,
            after,
            beforeLabel: `Version ${followedVersion}`,
            afterLabel: `Version ${mergedVersion}`,
            afterName: `version ${mergedVersion}`,
          },
        });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        const error = caught instanceof VersionReadError ? caught : new VersionReadError(String(mergedVersion), caught);
        setPublished({ key: publishedKey, error, reader: loadVersionYaml });
      });
    return () => {
      active = false;
    };
  }, [
    shownSource,
    publishedKey,
    followedId,
    followedVersion,
    followedNormalized,
    mergedId,
    mergedVersion,
    mergedNormalized,
    loadVersionYaml,
  ]);

  const proposedTexts = useMemo<Compared>(
    () => ({
      before: pullRequest.base.normalizedYaml ?? pullRequest.base.yaml,
      after: pullRequest.proposed.normalizedYaml ?? pullRequest.proposed.yaml,
      beforeLabel: `Version ${pullRequest.base.version}`,
      afterLabel: 'Proposal',
      afterName: 'the proposal',
    }),
    [pullRequest]
  );
  const publishedState =
    published?.key === publishedKey && (published.texts || published.reader === loadVersionYaml) ? published : null;
  const texts = shownSource === 'published' ? publishedState?.texts : proposedTexts;
  const diff = useMemo(() => (texts ? structuredDiff(texts.before, texts.after) : null), [texts]);
  // Right after a merge here the page has not loaded the new version yet: that is not an error.
  const readFailure = publishedState?.error && !(publishedState.error.notOnPage && awaitingPage) ? publishedState.error : null;
  const [view, setView] = useState<ViewMode>('structured');
  const [filter, setFilter] = useState<ChangeKind | null>(null);
  const shown: ViewMode = diff ? view : 'file';
  // Only the line-by-line view needs the texts as it shows them.
  const compared = useMemo(
    () => (texts && shown === 'file' ? textsToCompare(texts.before, texts.after) : null),
    [texts, shown]
  );

  return (
    <section className="space-y-4 rounded-xl border border-tp-hairline bg-tp-canvas p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-tp-ink">Changes</h3>
          {shownSource === 'published' ? (
            <p className="text-xs text-tp-steel">
              Version {mergedVersion} as it was published, compared with version {followedVersion}, the version it was
              merged on. It has the choices made when merging.
            </p>
          ) : (
            <p className="text-xs text-tp-steel">
              Proposal compared with version {pullRequest.base.version}, the version it is based on.
              {merged && ' What was published can differ where conflicts were resolved when merging.'}
            </p>
          )}
          {shownSource === 'proposed' &&
            (pullRequest.base.normalizedYaml !== undefined || pullRequest.proposed.normalizedYaml !== undefined) && (
              <SyntaxNote first={`Version ${pullRequest.base.version}`} second="the proposal" />
            )}
          {shownSource === 'published' && (followedNormalized !== undefined || mergedNormalized !== undefined) && (
            <SyntaxNote first={`Version ${mergedVersion}`} second={`version ${followedVersion}`} />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canShowPublished && <SourceToggle value={shownSource} onChange={setSource} />}
          {diff && <ViewToggle value={shown} onChange={setView} />}
        </div>
      </div>
      {!texts ? (
        readFailure ? (
          <p role="alert" className="rounded-xl border border-tp-severity-error-border bg-tp-severity-error-bg px-4 py-3 text-sm text-tp-ink">
            {readFailure.message}
          </p>
        ) : (
          <div className="rounded-xl border border-dashed border-tp-hairline-strong px-4 py-8 text-center text-sm text-tp-slate">
            Reading versions {followedVersion} and {mergedVersion}…
          </div>
        )
      ) : shown === 'structured' && diff ? (
        <DiffResult diff={diff} filter={filter && diff.totals[filter] > 0 ? filter : null} onFilterChange={setFilter} />
      ) : compared ? (
        <div className="space-y-2">
          {compared.reformatted && <FormatNote first={texts.beforeLabel} second={texts.afterName} />}
          <FileDiffView
            before={compared.before}
            after={compared.after}
            beforeLabel={texts.beforeLabel}
            afterLabel={texts.afterLabel}
            markers
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * What the page shares with its pull requests: its versions, its ETag, how to
 * take a merge in and where it shows a version.
 */
export interface PullRequestPageContext {
  /** The versions of the pricing the page loaded, to read the one a merge or an update follows. */
  versions: VersionData[];
  etag?: string;
  onMerged: (result: PullRequestMergeResult) => void;
  /** Offers to reload when the pricing changed since the page loaded it (412); says whether it was that. */
  onPricingChanged: (error: unknown) => boolean;
  /** Where the page shows a version of the pricing, and how it goes there without leaving the app. */
  versionHref: (versionId: string) => string;
  openVersion: (versionId: string) => void;
}

/** A plain click stays in the app; a modified one (new tab, new window) follows the link. */
const isPlainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * A pull request: while it is open, its merge box right below its header (so
 * what to do with it is in view however long its changes are), then its
 * description and what it proposes against the version it is based on. It is
 * reviewed here, not edited: from the merge box its author can bring it up to
 * the latest version or withdraw it, and a maintainer can merge or close it,
 * resolving conflicts by choosing a side.
 */
export default function PullRequestDetail({
  id,
  pricingId,
  onBack,
  context,
}: {
  id: string;
  /** The pricing of the page: a pull request of another one is not shown here. */
  pricingId: string;
  onBack: () => void;
  context: PullRequestPageContext;
}) {
  const { authUser } = useAuth();
  const { getPullRequest, closePullRequest } = usePricingPullRequestsApi();
  const loadLatestYaml = usePageVersionYaml(context.versions);
  const [pullRequest, setPullRequest] = useState<PullRequestDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  // Merged from its merge box: the page loads its versions again, the new one included.
  const [mergedHere, setMergedHere] = useState(false);

  useEffect(() => {
    let active = true;
    setPullRequest(null);
    setError(null);
    getPullRequest(id)
      .then(result => {
        if (!active) return;
        // A link that names a pull request of another pricing: its merge and edits would act on this page's.
        if (result.pricingId !== pricingId) setError(pullRequestMessage('NOT_FOUND'));
        else setPullRequest(result);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof PullRequestApiError
            ? pullRequestMessage(caught.status === 404 ? 'NOT_FOUND' : caught.code, { message: caught.message })
            : pullRequestMessage(null)
        );
      });
    return () => {
      active = false;
    };
  }, [id, pricingId, getPullRequest]);

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-tp-steel transition-colors hover:text-tp-ink"
    >
      <FiArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
      All pull requests
    </button>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <div role="alert" className="rounded-xl border border-tp-severity-error-border bg-tp-severity-error-bg px-4 py-3 text-sm text-tp-ink">
          {error}
        </div>
      </div>
    );
  }
  if (!pullRequest) {
    return (
      <div className="space-y-4">
        {back}
        <div className="rounded-xl border border-dashed border-tp-hairline-strong px-4 py-10 text-center text-sm text-tp-slate">
          Loading pull request…
        </div>
      </div>
    );
  }

  const isAuthor = Boolean(pullRequest.author && pullRequest.author.id === authUser.user?.id);
  const { origin, closed, merged } = pullRequest;

  return (
    <div className="space-y-5">
      {back}

      <header className="space-y-3 rounded-xl border border-tp-hairline bg-tp-canvas p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 break-words font-display text-xl font-normal text-tp-ink">
            <span className="mr-2 tabular-nums text-tp-steel">#{pullRequest.number}</span>
            {pullRequest.title}
          </h2>
          <StateChip pullRequest={pullRequest} />
        </div>
        <p className="text-xs text-tp-steel">
          {pullRequestAuthorName(pullRequest.author)} proposed changes to version {pullRequest.base.version} ·
          opened {ago(pullRequest.createdAt)}
          {merged ? ` · merged ${ago(merged.at)}` : ''}
          {closed ? ` · closed ${ago(closed.at)}` : ''}
        </p>
        <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          {/* Once merged, the version it became is named below, when the caller may read it. */}
          {!merged && (
            <div>
              <dt className="text-tp-steel">Suggested version</dt>
              <dd className="mt-0.5 break-words font-medium text-tp-ink">{pullRequest.proposed.suggestedVersion}</dd>
            </div>
          )}
          {origin && (
            <div>
              <dt className="text-tp-steel">Proposed from the fork</dt>
              <dd className="mt-0.5 break-words font-medium text-tp-ink">
                {origin.organization.displayName} / {origin.name}
                {origin.version ? ` (version ${origin.version})` : ''}
                {origin.editedAfterProposal && (
                  <span className="ml-2 font-normal text-tp-steel">edited after it was proposed</span>
                )}
              </dd>
            </div>
          )}
        </dl>
      </header>

      {/* Right below the header: however long its changes are, what to do with it is in view. */}
      {pullRequest.status === 'open' && (
        <MergeBox
          key={`${pullRequest.id}:${pullRequest.proposalRevision}`}
          pullRequest={pullRequest}
          isAuthor={isAuthor}
          etag={context.etag}
          loadLatestYaml={loadLatestYaml}
          onPricingChanged={context.onPricingChanged}
          onClose={() => setIsClosing(true)}
          onMerged={result => {
            setMergedHere(true);
            setPullRequest(result.pullRequest);
            context.onMerged(result);
          }}
          onUpdated={setPullRequest}
        />
      )}

      {merged && (
        <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-tp-severity-success-border bg-tp-severity-success-bg p-4 text-sm">
          <p className="inline-flex items-center gap-2 font-medium text-tp-ink">
            <FiGitMerge aria-hidden="true" className="h-4 w-4 shrink-0 text-tp-severity-success" />
            {merged.version ? `Merged as version ${merged.version}` : 'Merged'}
          </p>
          {/* The server names the merged version only to who may read it. */}
          {merged.versionId && merged.version && (
            <a
              href={context.versionHref(merged.versionId)}
              onClick={event => {
                if (!isPlainClick(event)) return;
                event.preventDefault();
                context.openVersion(merged.versionId!);
              }}
              className="cursor-pointer text-xs font-semibold text-tp-primary underline-offset-2 hover:underline"
            >
              View version {merged.version}
            </a>
          )}
        </section>
      )}

      {closed && (
        <section className="rounded-xl border border-tp-hairline bg-tp-surface p-4 text-sm">
          <p className="font-medium text-tp-ink">
            {closed.kind === 'withdrawn' ? 'Withdrawn by its author' : 'Rejected by a maintainer'}
          </p>
          {closed.reason && <p className="mt-1 whitespace-pre-wrap break-words text-tp-slate">{closed.reason}</p>}
        </section>
      )}

      <section className="rounded-xl border border-tp-hairline bg-tp-canvas p-4 sm:p-5">
        <h3 className="mb-2 text-base font-semibold text-tp-ink">Description</h3>
        {pullRequest.description ? (
          <p className="whitespace-pre-wrap break-words text-sm text-tp-charcoal">{pullRequest.description}</p>
        ) : (
          <p className="text-sm italic text-tp-steel">No description.</p>
        )}
      </section>

      <Changes
        key={`${pullRequest.id}:${pullRequest.proposalRevision}:${pullRequest.status}`}
        pullRequest={pullRequest}
        loadVersionYaml={loadLatestYaml}
        awaitingPage={mergedHere}
      />

      <AnimatePresence>
        {isClosing && (
          <CloseDialog
            number={pullRequest.number}
            withdraw={isAuthor}
            onClose={() => setIsClosing(false)}
            onConfirm={async reason => {
              setPullRequest(await closePullRequest(pullRequest.id, reason));
              setIsClosing(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
