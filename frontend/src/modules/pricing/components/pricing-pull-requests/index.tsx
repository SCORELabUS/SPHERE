import { useState } from 'react';
import type { PullRequestList as PullRequestPage } from '../../types/pull-requests';
import PullRequestList, { type PullRequestFilter } from './pull-request-list';
import PullRequestDetail from './pull-request-detail';

/**
 * The Pull requests tab of a pricing: the list, or the pull request picked in
 * it. Which one is open belongs to the page (`?pr=`), so links can open it.
 */
export default function PricingPullRequestsTab({
  pricingId,
  selectedId,
  onSelect,
  onCountsChange,
}: {
  pricingId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCountsChange?: (counts: PullRequestPage['counts']) => void;
}) {
  // Kept here so going back from a pull request returns to the same filter and page.
  const [filter, setFilter] = useState<PullRequestFilter>('open');
  const [page, setPage] = useState(1);

  if (selectedId) return <PullRequestDetail id={selectedId} onBack={() => onSelect(null)} />;
  return (
    <PullRequestList
      pricingId={pricingId}
      filter={filter}
      page={page}
      onFilterChange={next => {
        setFilter(next);
        setPage(1);
      }}
      onPageChange={setPage}
      onOpen={onSelect}
      onCountsChange={onCountsChange}
    />
  );
}
