import { useEffect, useRef, useState } from 'react';
import { FiGitPullRequest } from 'react-icons/fi';
import Pagination from '../pagination';
import { PullRequestApiError, usePricingPullRequestsApi } from '../../api/pricingPullRequestsApi';
import { pullRequestMessage } from '../../../core/utils/pull-request-state';
import type { PullRequestList as PullRequestPage, PullRequestStatus } from '../../types/pull-requests';
import PullRequestRow from './pull-request-row';

/** The pull requests shown: one status, or all of them. */
export type PullRequestFilter = PullRequestStatus | 'all';

/** Rows per page, as the API pages them. */
const PAGE_SIZE = 20;

const FILTERS: { value: PullRequestFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

const EMPTY_MESSAGES: Record<PullRequestFilter, string> = {
  open: 'No open pull requests.',
  merged: 'No merged pull requests.',
  closed: 'No closed pull requests.',
  all: 'No pull requests yet.',
};

function countOf(counts: PullRequestPage['counts'] | undefined, filter: PullRequestFilter) {
  if (!counts) return null;
  return filter === 'all' ? counts.open + counts.merged + counts.closed : counts[filter];
}

/**
 * The pull requests of a pricing the caller may see (all of them for a
 * maintainer, their own for anyone else), filtered by status and paged.
 */
export default function PullRequestList({
  pricingId,
  filter,
  page,
  onFilterChange,
  onPageChange,
  onOpen,
  onCountsChange,
}: {
  pricingId: string;
  filter: PullRequestFilter;
  page: number;
  onFilterChange: (filter: PullRequestFilter) => void;
  onPageChange: (page: number) => void;
  onOpen: (id: string) => void;
  onCountsChange?: (counts: PullRequestPage['counts']) => void;
}) {
  const { listPullRequests } = usePricingPullRequestsApi();
  const [list, setList] = useState<PullRequestPage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A notification only: a new callback must not load the list again.
  const countsListener = useRef(onCountsChange);
  useEffect(() => {
    countsListener.current = onCountsChange;
  }, [onCountsChange]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    listPullRequests(pricingId, { status: filter === 'all' ? undefined : filter, page })
      .then(result => {
        if (!active) return;
        setList(result);
        countsListener.current?.(result.counts);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setList(null);
        setError(
          caught instanceof PullRequestApiError
            ? pullRequestMessage(caught.code, { message: caught.message })
            : pullRequestMessage(null)
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [pricingId, filter, page, listPullRequests]);

  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter pull requests" className="flex gap-1 overflow-x-auto border-b border-tp-hairline">
          {FILTERS.map(({ value, label }) => {
            const count = countOf(list?.counts, value);
            const active = filter === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onFilterChange(value)}
                className={`-mb-px flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  active ? 'border-tp-primary text-tp-primary' : 'border-transparent text-tp-steel hover:text-tp-ink'
                }`}
              >
                {label}
                {count !== null && (
                  <span className="rounded-full bg-tp-surface px-1.5 text-xs tabular-nums text-tp-slate">{count}</span>
                )}
              </button>
            );
          })}
        </div>
        {list?.viewer.isMaintainer === false && (
          <p className="text-xs text-tp-steel">You see the pull requests you opened.</p>
        )}
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-tp-severity-error-border bg-tp-severity-error-bg px-4 py-3 text-sm text-tp-ink">
          {error}
        </div>
      ) : isLoading && !list ? (
        <div className="rounded-xl border border-dashed border-tp-hairline-strong px-4 py-10 text-center text-sm text-tp-slate">
          Loading pull requests…
        </div>
      ) : list && list.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-tp-hairline-strong px-4 py-10 text-center">
          <FiGitPullRequest aria-hidden="true" className="h-6 w-6 text-tp-muted" />
          <p className="text-sm text-tp-slate">{EMPTY_MESSAGES[filter]}</p>
        </div>
      ) : list ? (
        <ul
          className={`divide-y divide-tp-hairline overflow-hidden rounded-xl border border-tp-hairline bg-tp-canvas transition-opacity ${
            isLoading ? 'opacity-50' : ''
          }`}
        >
          {list.items.map(pullRequest => (
            <PullRequestRow key={pullRequest.id} pullRequest={pullRequest} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}
