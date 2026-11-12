import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import jsYaml from 'js-yaml';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { FiArrowLeft } from 'react-icons/fi';
import { useAuth } from '../../../auth/hooks/useAuth';
import { PullRequestApiError, usePricingPullRequestsApi } from '../../api/pricingPullRequestsApi';
import { pullRequestAuthorName, pullRequestMessage } from '../../../core/utils/pull-request-state';
import { diffPricings, type ChangeKind } from '../../utils/pricing-diff';
import { DiffResult, ViewToggle, type ViewMode } from '../pricing-version-diff';
import FileDiffView from '../pricing-version-diff/file-diff-view';
import type { PullRequestDetail as PullRequestDetailData } from '../../types/pull-requests';
import StateChip from './state-chip';
import CloseDialog from './close-dialog';

const ago = (date: string) => `${formatDistanceToNow(parseISO(date))} ago`;

/** The structured comparison, or null when either side is not a YAML mapping it can read. */
function structuredDiff(pullRequest: PullRequestDetailData) {
  try {
    // SPHERE sets the pricing's name when it merges, so a different `saasName` is not a change.
    return diffPricings(jsYaml.load(pullRequest.base.yaml), jsYaml.load(pullRequest.proposed.yaml), {
      ignoreKeys: ['saasName'],
    });
  } catch {
    return null;
  }
}

function Changes({ pullRequest }: { pullRequest: PullRequestDetailData }) {
  const diff = useMemo(() => structuredDiff(pullRequest), [pullRequest]);
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
        </div>
        {diff && <ViewToggle value={shown} onChange={setView} />}
      </div>
      {shown === 'structured' && diff ? (
        <DiffResult diff={diff} filter={filter && diff.totals[filter] > 0 ? filter : null} onFilterChange={setFilter} />
      ) : (
        <FileDiffView
          before={pullRequest.base.yaml}
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
 * A pull request: what it proposes against the version it is based on, its
 * description, where it stands and, for its author or a maintainer, closing it.
 */
export default function PullRequestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { authUser } = useAuth();
  const { getPullRequest, closePullRequest } = usePricingPullRequestsApi();
  const [pullRequest, setPullRequest] = useState<PullRequestDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    let active = true;
    setPullRequest(null);
    setError(null);
    getPullRequest(id)
      .then(result => {
        if (active) setPullRequest(result);
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
  }, [id, getPullRequest]);

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
        {pullRequest.permissions.close && (
          <div className="flex flex-wrap gap-2 border-t border-tp-hairline pt-3">
            <button
              type="button"
              onClick={() => setIsClosing(true)}
              className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-1.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
            >
              {isAuthor ? 'Withdraw' : 'Close'}
            </button>
          </div>
        )}
      </header>

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

      <Changes key={`${pullRequest.id}:${pullRequest.proposalRevision}`} pullRequest={pullRequest} />

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
