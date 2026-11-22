import { useCallback, useState, type ReactNode } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { Warnings } from '../../../core/components/pricing-merge-resolver';
import { useMergeResolver } from '../../../core/hooks/useMergeResolver';
import ResolutionStatus from './resolution-status';
import ResolverWorkspace from './resolver-workspace';
import { useResolverWorkspace } from './use-resolver-workspace';
import { usePricingPullRequestsApi } from '../../api/pricingPullRequestsApi';
import type {
  ConflictResolutions,
  PullRequestDetail,
  PullRequestMergeResult,
  PullRequestVersionRef,
} from '../../types/pull-requests';

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-tp-severity-warning-border bg-tp-severity-warning-bg px-3 py-2 text-xs text-tp-ink">
      <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tp-severity-warning" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Confirming the merge of a pull request, in its merge box: whether it has
 * conflicts (resolved over the whole window, in `ResolverWorkspace`), then the
 * label and visibility of the version it publishes. The merge carries the
 * pricing's ETag as the page loaded it.
 */
export default function MergePanel({
  pullRequest,
  etag,
  loadLatestYaml,
  onMerged,
  onPricingChanged,
  onCancel,
  resolveFirst = false,
}: {
  pullRequest: PullRequestDetail;
  etag?: string;
  loadLatestYaml: (target: PullRequestVersionRef) => Promise<string>;
  onMerged: (result: PullRequestMergeResult) => void;
  /** Offers to reload when the pricing changed since the page loaded it (412); says whether it was that. */
  onPricingChanged: (error: unknown) => boolean;
  onCancel: () => void;
  /** Opens the resolver at once, when the merge box already knew of conflicts. */
  resolveFirst?: boolean;
}) {
  const { previewPullRequestMerge, mergePullRequest } = usePricingPullRequestsApi();
  const resolver = useMergeResolver(
    useCallback(
      (resolutions: ConflictResolutions) => previewPullRequestMerge(pullRequest.id, 'merge', resolutions),
      [previewPullRequestMerge, pullRequest.id]
    )
  );
  const workspace = useResolverWorkspace(resolver, resolveFirst);
  const { preview } = resolver;
  const [label, setLabel] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const version = (label ?? preview?.suggestedVersion ?? '').trim();
  const asPrivate = isPrivate ?? preview?.defaults?.private ?? false;
  const labelTaken = Boolean(preview?.versionTaken && version === preview.suggestedVersion);

  let blockReason = resolver.blockReason;
  if (!blockReason && preview?.outcome === 'no-changes') {
    blockReason = 'Nothing to merge: the latest version already has everything this pull request proposes.';
  }
  if (!blockReason && !version) blockReason = 'Name the version to publish.';
  if (!blockReason && labelTaken) blockReason = `Version ${version} already exists: choose another label.`;

  const submit = async () => {
    const submission = resolver.submission();
    if (!submission || blockReason) return;
    setIsSubmitting(true);
    setError(null);
    try {
      onMerged(await mergePullRequest(pullRequest.id, { ...submission, version, private: asPrivate }, etag));
    } catch (caught) {
      if (!onPricingChanged(caught)) setError(resolver.submissionFailed(caught));
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-label={`Merge pull request #${pullRequest.number}`} className="space-y-4">
      {/* While the resolver covers the window, it says all this itself. */}
      {!workspace.isOpen && (
        <>
          <ResolutionStatus resolver={resolver} onOpen={workspace.open} buttonRef={workspace.opener} />
          <Warnings resolver={resolver} />
        </>
      )}

      {preview && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="merge-version" className="block text-sm font-medium text-tp-slate">
              Version
            </label>
            <input
              id="merge-version"
              value={label ?? preview.suggestedVersion}
              maxLength={100}
              onChange={event => setLabel(event.target.value)}
              className="w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink outline-none focus:border-tp-primary"
            />
            {label === null && preview.suggestedVersionFollows && (
              <p className="text-xs text-tp-steel">
                {preview.suggestedVersionFollows.proposal
                  ? `The proposal names it ${preview.suggestedVersionFollows.proposal}, which reads as older than version ${preview.suggestedVersionFollows.latest}, the latest public one.`
                  : `The proposal names no version: this one follows version ${preview.suggestedVersionFollows.latest}, the latest public one.`}
              </p>
            )}
            {labelTaken && <Notice>Version {version} already exists in this pricing.</Notice>}
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 block text-sm font-medium text-tp-slate">Visibility</legend>
            <div className="flex flex-wrap gap-2">
              {[
                { value: false, label: 'Public' },
                { value: true, label: 'Private' },
              ].map(option => (
                <label
                  key={option.label}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                    asPrivate === option.value ? 'border-tp-primary text-tp-ink' : 'border-tp-hairline-strong text-tp-steel'
                  }`}
                >
                  <input
                    type="radio"
                    name="merge-visibility"
                    checked={asPrivate === option.value}
                    onChange={() => setIsPrivate(option.value)}
                    className="cursor-pointer accent-tp-primary"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {preview.target.private && !asPrivate && (
              <Notice>
                Version {preview.target.version}, the one this merge follows, is private. Publishing the result as
                public shows what it takes from that version to everyone who can see this pricing.
              </Notice>
            )}
          </fieldset>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-tp-severity-error-border bg-tp-severity-error-bg px-3 py-2 text-sm text-tp-ink">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-tp-hairline pt-4">
        {blockReason && (
          <p id="merge-block-reason" className="mr-auto text-xs text-tp-steel">
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
          aria-describedby={blockReason ? 'merge-block-reason' : undefined}
          onClick={submit}
          className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-50"
        >
          {isSubmitting ? 'Merging…' : 'Confirm merge'}
        </button>
      </div>

      {workspace.isOpen && (
        <ResolverWorkspace
          title={resolver.state.conflicts.length > 0 ? 'Resolve conflicts' : 'Review the merge'}
          subtitle={`#${pullRequest.number} ${pullRequest.title}`}
          resolver={resolver}
          loadLatestYaml={loadLatestYaml}
          purpose="merge"
          initialView={workspace.initialView}
          onDone={workspace.close}
        />
      )}
    </section>
  );
}
