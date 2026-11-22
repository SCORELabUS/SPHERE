import { useCallback, useState } from 'react';
import { Warnings } from '../../../core/components/pricing-merge-resolver';
import { useMergeResolver } from '../../../core/hooks/useMergeResolver';
import { usePricingPullRequestsApi } from '../../api/pricingPullRequestsApi';
import type {
  ConflictResolutions,
  PullRequestDetail,
  PullRequestVersionRef,
  PullRequestWithWarnings,
} from '../../types/pull-requests';
import ResolutionStatus from './resolution-status';
import ResolverWorkspace from './resolver-workspace';
import { useResolverWorkspace } from './use-resolver-workspace';

/**
 * Confirming, in the merge box, that a pull request is brought up to the latest
 * public version: its author resolves the proposal against that version (over
 * the whole window, in `ResolverWorkspace`), which becomes the new base.
 */
export default function UpdatePanel({
  pullRequest,
  loadLatestYaml,
  onUpdated,
  onCancel,
  resolveFirst = false,
}: {
  pullRequest: PullRequestDetail;
  loadLatestYaml: (target: PullRequestVersionRef) => Promise<string>;
  onUpdated: (pullRequest: PullRequestWithWarnings) => void;
  onCancel: () => void;
  /** Opens the resolver at once, when the merge box already knew of conflicts. */
  resolveFirst?: boolean;
}) {
  const { previewPullRequestMerge, updatePullRequestToLatest } = usePricingPullRequestsApi();
  const resolver = useMergeResolver(
    useCallback(
      (resolutions: ConflictResolutions) => previewPullRequestMerge(pullRequest.id, 'update', resolutions),
      [previewPullRequestMerge, pullRequest.id]
    )
  );
  const workspace = useResolverWorkspace(resolver, resolveFirst);
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
    <section aria-label={`Update pull request #${pullRequest.number}`} className="space-y-4">
      {/* While the resolver covers the window, it says all this itself. */}
      {!workspace.isOpen && (
        <>
          <ResolutionStatus resolver={resolver} onOpen={workspace.open} buttonRef={workspace.opener} />
          <Warnings resolver={resolver} />
        </>
      )}

      {preview?.outcome === 'no-changes' && (
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

      {workspace.isOpen && (
        <ResolverWorkspace
          title={resolver.state.conflicts.length > 0 ? 'Resolve conflicts' : 'Review the update'}
          subtitle={`#${pullRequest.number} ${pullRequest.title}`}
          resolver={resolver}
          loadLatestYaml={loadLatestYaml}
          purpose="update"
          initialView={workspace.initialView}
          onDone={workspace.close}
        />
      )}
    </section>
  );
}
