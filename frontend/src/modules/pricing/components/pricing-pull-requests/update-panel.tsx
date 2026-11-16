import { useCallback, useState } from 'react';
import PricingMergeResolver from '../../../core/components/pricing-merge-resolver';
import { useMergeResolver } from '../../../core/hooks/useMergeResolver';
import { usePricingPullRequestsApi } from '../../api/pricingPullRequestsApi';
import type {
  ConflictResolutions,
  PullRequestDetail,
  PullRequestVersionRef,
  PullRequestWithWarnings,
} from '../../types/pull-requests';

/**
 * Bringing a pull request up to the latest public version: its author resolves
 * the proposal against that version, which becomes the new base.
 */
export default function UpdatePanel({
  pullRequest,
  loadLatestYaml,
  onUpdated,
  onCancel,
}: {
  pullRequest: PullRequestDetail;
  loadLatestYaml: (target: PullRequestVersionRef) => Promise<string>;
  onUpdated: (pullRequest: PullRequestWithWarnings) => void;
  onCancel: () => void;
}) {
  const { previewPullRequestMerge, updatePullRequestToLatest } = usePricingPullRequestsApi();
  const resolver = useMergeResolver(
    useCallback(
      (resolutions: ConflictResolutions) => previewPullRequestMerge(pullRequest.id, 'update', resolutions),
      [previewPullRequestMerge, pullRequest.id]
    )
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { blockReason, preview } = resolver;

  const submit = async () => {
    const submission = resolver.submission();
    if (!submission) return;
    setIsSubmitting(true);
    setError(null);
    try {
      onUpdated(await updatePullRequestToLatest(pullRequest.id, submission));
    } catch (caught) {
      setError(resolver.submissionFailed(caught));
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="update-panel-title" className="space-y-5 rounded-xl border border-tp-hairline bg-tp-canvas p-4 sm:p-5">
      <div>
        <h3 id="update-panel-title" className="text-base font-semibold text-tp-ink">
          Update to the latest version
        </h3>
        <p className="text-xs text-tp-steel">
          Your proposal is combined with the latest public version, which becomes the version it is based on.
        </p>
      </div>

      <PricingMergeResolver resolver={resolver} loadLatestYaml={loadLatestYaml} />

      {preview?.outcome === 'no-changes' && resolver.state.manualYaml === null && (
        <p className="rounded-lg border border-tp-severity-info-border bg-tp-severity-info-bg px-3 py-2 text-xs text-tp-ink">
          The latest version already has everything you propose: after updating, the pull request has no changes.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-tp-severity-error-border bg-tp-severity-error-bg px-3 py-2 text-sm text-tp-ink">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-tp-hairline pt-4">
        {blockReason && (
          <p id="update-block-reason" className="mr-auto text-xs text-tp-steel">
            {blockReason}
          </p>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={Boolean(blockReason) || isSubmitting}
          aria-describedby={blockReason ? 'update-block-reason' : undefined}
          onClick={submit}
          className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-50"
        >
          {isSubmitting ? 'Updating…' : 'Update pull request'}
        </button>
      </div>
    </section>
  );
}
