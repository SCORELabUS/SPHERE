import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { PullRequestList as PullRequestPage, PullRequestVersionRef } from '../../types/pull-requests';
import PullRequestList, { type PullRequestFilter } from './pull-request-list';
import PullRequestDetail, { type PullRequestPageContext } from './pull-request-detail';
import UploadProposalModal from './upload-proposal-modal';
import { usePageVersionYaml } from './use-page-version-yaml';

/**
 * The Pull requests tab of a pricing: the list, or the pull request picked in
 * it. Which one is open belongs to the page (`?pr=`), so links can open it.
 * Proposals start here too, in the editor or from an uploaded YAML file.
 */
export default function PricingPullRequestsTab({
  pricingId,
  selectedId,
  onSelect,
  onCountsChange,
  context,
}: {
  pricingId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCountsChange?: (counts: PullRequestPage['counts']) => void;
  /** What merging and proposing need from the pricing page. */
  context: PullRequestPageContext;
}) {
  // Kept here so going back from a pull request returns to the same filter and page.
  const [filter, setFilter] = useState<PullRequestFilter>('open');
  const [page, setPage] = useState(1);
  // The latest public version an uploaded file is proposed on, while its dialog is open.
  const [uploadOn, setUploadOn] = useState<PullRequestVersionRef | null>(null);
  const loadVersionYaml = usePageVersionYaml(context.versions);

  if (selectedId) return <PullRequestDetail id={selectedId} onBack={() => onSelect(null)} context={context} />;
  return (
    <>
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
        onProposeInEditor={(latest, mode) => context.openEditor(latest, { mode })}
        onUpload={setUploadOn}
      />
      <AnimatePresence>
        {uploadOn && (
          <UploadProposalModal
            pricingId={pricingId}
            latest={uploadOn}
            loadLatestYaml={loadVersionYaml}
            onClose={() => setUploadOn(null)}
            onCreated={created => {
              setUploadOn(null);
              onSelect(created.id);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
