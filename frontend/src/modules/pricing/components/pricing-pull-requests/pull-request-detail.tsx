import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { AnimatePresence } from 'framer-motion';
import jsYaml from 'js-yaml';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { FiArrowLeft, FiGitMerge } from 'react-icons/fi';
import { useAuth } from '../../../auth/hooks/useAuth';
import { PullRequestApiError, usePricingPullRequestsApi } from '../../api/pricingPullRequestsApi';
import { pullRequestAuthorName, pullRequestMessage } from '../../../core/utils/pull-request-state';
import { diffPricings, type ChangeKind } from '../../utils/pricing-diff';
import { DiffResult, ViewToggle, type ViewMode } from '../pricing-version-diff';
import FileDiffView from '../pricing-version-diff/file-diff-view';
import type { VersionData } from '../../types/card';
import type {
  PullRequestDetail as PullRequestDetailData,
  PullRequestMergeResult,
  PullRequestVersionRef,
} from '../../types/pull-requests';
import { usePageVersionYaml } from './use-page-version-yaml';
import StateChip from './state-chip';
import CloseDialog from './close-dialog';
import MergePanel from './merge-panel';
import UpdatePanel from './update-panel';

const ago = (date: string) => `${formatDistanceToNow(parseISO(date))} ago`;

/**
 * The base the proposal is compared with: as SPHERE upgrades it when it is stored in an
 * older syntax, since the proposal is stored upgraded and the upgrade is not the author's.
 */
const comparedBase = (pullRequest: PullRequestDetailData) => pullRequest.base.normalizedYaml ?? pullRequest.base.yaml;

/** The structured comparison, or null when either side is not a YAML mapping it can read. */
function structuredDiff(pullRequest: PullRequestDetailData) {
  try {
    // SPHERE sets the pricing's name when it merges, so a different `saasName` is not a change.
    return diffPricings(jsYaml.load(comparedBase(pullRequest)), jsYaml.load(pullRequest.proposed.yaml), {
      ignoreKeys: ['saasName'],
    });
  } catch {
    return null;
  }
}

function Changes({ pullRequest }: { pullRequest: PullRequestDetailData }) {
  const diff = useMemo(() => structuredDiff(pullRequest), [pullRequest]);
  const upgraded = pullRequest.base.normalizedYaml !== undefined;
  const [view, setView] = useState<ViewMode>('structured');
  const [filter, setFilter] = useState<ChangeKind | null>(null);
  const shown: ViewMode = diff ? view : 'file';

  return (
    <section className="space-y-4 rounded-xl border border-tp-hairline bg-tp-canvas p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-tp-ink">Changes</h3>
          <p className="text-xs text-tp-steel">
            Proposal compared with version {pullRequest.base.version}, the version it is based on.
          </p>
          {upgraded && (
            <p className="mt-1 text-xs text-tp-steel">
              Version {pullRequest.base.version} is written in an older Pricing2Yaml syntax. It is compared as SPHERE
              upgrades it, like the proposal, so the upgrade is not shown as a change.
            </p>
          )}
        </div>
        {diff && <ViewToggle value={shown} onChange={setView} />}
      </div>
      {shown === 'structured' && diff ? (
        <DiffResult diff={diff} filter={filter && diff.totals[filter] > 0 ? filter : null} onFilterChange={setFilter} />
      ) : (
        <FileDiffView
          before={comparedBase(pullRequest)}
          after={pullRequest.proposed.yaml}
          beforeLabel={`Version ${pullRequest.base.version}`}
          afterLabel="Proposal"
          markers
        />
      )}
    </section>
  );
}

/**
 * What the page shares with its pull requests: its versions, its ETag, how to
 * take a merge in and how to open the editor to propose or edit a proposal.
 */
export interface PullRequestPageContext {
  /** The versions of the pricing the page loaded, to read the one a merge or an update follows. */
  versions: VersionData[];
  etag?: string;
  onMerged: (result: PullRequestMergeResult) => void;
  /** Offers to reload when the pricing changed since the page loaded it (412); says whether it was that. */
  onPricingChanged: (error: unknown) => boolean;
  /** Opens the editor on a version of the pricing, or on an open pull request's proposal to edit it again. */
  openEditor: (version: PullRequestVersionRef, options: { mode: 'visual' | 'code'; pullRequestId?: string }) => void;
  /** Where the page shows a version of the pricing, and how it goes there without leaving the app. */
  versionHref: (versionId: string) => string;
  openVersion: (versionId: string) => void;
}

/** A plain click stays in the app; a modified one (new tab, new window) follows the link. */
const isPlainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * A pull request: what it proposes against the version it is based on, its
 * description and where it stands. Its author can edit its proposal again,
 * bring it up to the latest version or withdraw it; a maintainer can merge or
 * close it.
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
  const [panel, setPanel] = useState<'merge' | 'update' | null>(null);

  useEffect(() => {
    let active = true;
    setPullRequest(null);
    setError(null);
    setPanel(null);
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
  const { origin, closed, merged, permissions } = pullRequest;

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
          <div>
            <dt className="text-tp-steel">Suggested version</dt>
            <dd className="mt-0.5 break-words font-medium text-tp-ink">{pullRequest.proposed.suggestedVersion}</dd>
          </div>
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
        {(permissions.merge || permissions.update || permissions.editProposal || permissions.close) && (
          <div className="flex flex-wrap gap-2 border-t border-tp-hairline pt-3">
            {permissions.merge && (
              <button
                type="button"
                aria-pressed={panel === 'merge'}
                onClick={() => setPanel(panel === 'merge' ? null : 'merge')}
                className="cursor-pointer rounded-lg bg-tp-primary px-3 py-1.5 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
              >
                Merge…
              </button>
            )}
            {permissions.editProposal && (
              <button
                type="button"
                onClick={() =>
                  context.openEditor(
                    { id: pullRequest.base.versionId, version: pullRequest.base.version },
                    { mode: 'code', pullRequestId: pullRequest.id }
                  )
                }
                className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
              >
                Edit proposal
              </button>
            )}
            {permissions.update && (
              <button
                type="button"
                aria-pressed={panel === 'update'}
                onClick={() => setPanel(panel === 'update' ? null : 'update')}
                className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
              >
                Update to latest
              </button>
            )}
            {permissions.close && (
              <button
                type="button"
                onClick={() => setIsClosing(true)}
                className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
              >
                {isAuthor ? 'Withdraw' : 'Close'}
              </button>
            )}
          </div>
        )}
      </header>

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

      {panel === 'merge' && permissions.merge ? (
        <MergePanel
          pullRequest={pullRequest}
          etag={context.etag}
          loadLatestYaml={loadLatestYaml}
          onPricingChanged={context.onPricingChanged}
          onCancel={() => setPanel(null)}
          onMerged={result => {
            setPullRequest(result.pullRequest);
            setPanel(null);
            context.onMerged(result);
          }}
        />
      ) : panel === 'update' && permissions.update ? (
        <UpdatePanel
          pullRequest={pullRequest}
          loadLatestYaml={loadLatestYaml}
          onCancel={() => setPanel(null)}
          onUpdated={updated => {
            setPullRequest(updated);
            setPanel(null);
          }}
        />
      ) : (
        <Changes key={`${pullRequest.id}:${pullRequest.proposalRevision}`} pullRequest={pullRequest} />
      )}

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
