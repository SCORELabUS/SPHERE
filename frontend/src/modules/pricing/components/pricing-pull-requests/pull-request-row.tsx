import { formatDistanceToNow, parseISO } from 'date-fns';
import { FiChevronRight } from 'react-icons/fi';
import type { PullRequestSummary } from '../../types/pull-requests';
import { pullRequestAuthorName } from '../../../core/utils/pull-request-state';
import StateChip from './state-chip';

/** One pull request of the list: number, title, author, base version, age and state. */
export default function PullRequestRow({
  pullRequest,
  onOpen,
}: {
  pullRequest: PullRequestSummary;
  onOpen: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(pullRequest.id)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-tp-surface focus-visible:bg-tp-surface focus-visible:outline-none"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 text-sm tabular-nums text-tp-steel">#{pullRequest.number}</span>
            <span className="min-w-0 break-words text-sm font-semibold text-tp-ink">{pullRequest.title}</span>
          </div>
          <p className="mt-1 text-xs text-tp-steel">
            {pullRequestAuthorName(pullRequest.author)} · based on {pullRequest.base.version} · opened{' '}
            {formatDistanceToNow(parseISO(pullRequest.createdAt))} ago
          </p>
        </div>
        <StateChip pullRequest={pullRequest} />
        <FiChevronRight aria-hidden="true" className="hidden h-4 w-4 shrink-0 text-tp-muted sm:block" />
      </button>
    </li>
  );
}
