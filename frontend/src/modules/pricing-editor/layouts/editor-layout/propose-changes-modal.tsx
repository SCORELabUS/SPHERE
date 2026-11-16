import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { FiAlertTriangle, FiCheck, FiExternalLink, FiGitPullRequest, FiX } from 'react-icons/fi';
import PricingMergeResolver from '../../../core/components/pricing-merge-resolver';
import ProposalFields from '../../../core/components/proposal-fields';
import ProposalSummary from '../../../core/components/proposal-summary';
import { useMergeResolver } from '../../../core/hooks/useMergeResolver';
import { usePricingVersionReader } from '../../../core/hooks/usePricingVersionReader';
import {
  proposalFieldsError,
  pullRequestMessage,
  pullRequestWarningMessage,
} from '../../../core/utils/pull-request-state';
import { PullRequestApiError, usePricingPullRequestsApi } from '../../../pricing/api/pricingPullRequestsApi';
import { summarizeProposal } from '../../../pricing/utils/proposal-summary';
import type {
  ConflictResolutions,
  PullRequestVersionRef,
  PullRequestWithWarnings,
} from '../../../pricing/types/pull-requests';
import type { EditorSourcePricing } from '../../contexts/editorValueContext';

/** Where the pricing page opens a pull request. */
function pullRequestHref(source: EditorSourcePricing, id: string): string {
  const query = new URLSearchParams({ tab: 'pull-requests', pr: id });
  if (source.collectionSlug) query.set('collection', source.collectionSlug);
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/pricings/${source.organizationId}/${source.slug}?${query.toString()}`;
}

function messageOf(caught: unknown): string {
  return caught instanceof PullRequestApiError
    ? pullRequestMessage(caught.status === 404 ? 'NOT_FOUND' : caught.code, {
        message: caught.message,
        latest: caught.latest,
        number: caught.number,
      })
    : pullRequestMessage(null);
}

/**
 * The editor's text combined with the latest public version, when a newer one
 * was published after the editor opened: the conflicts are resolved here and
 * the result is proposed on that version. The editor's text is not touched.
 */
function ApplyOnLatest({
  source,
  yaml,
  fieldsError,
  submitLabel,
  onSubmit,
}: {
  source: EditorSourcePricing & { pricingId: string; versionId: string };
  yaml: string;
  fieldsError: string | null;
  submitLabel: string;
  onSubmit: (base: PullRequestVersionRef, proposedYaml: string) => Promise<void>;
}) {
  const { previewProposal } = usePricingPullRequestsApi();
  const readVersion = usePricingVersionReader();
  const { pricingId, versionId } = source;
  const resolver = useMergeResolver(
    useCallback(
      (resolutions: ConflictResolutions) =>
        previewProposal({ kind: 'text', pricingId, baseVersionId: versionId, proposedYaml: yaml }, resolutions),
      [previewProposal, pricingId, versionId, yaml]
    )
  );
  const loadLatestYaml = useCallback(
    (target: PullRequestVersionRef) => readVersion(source, target),
    [readVersion, source]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { preview } = resolver;

  let blockReason = resolver.blockReason;
  if (!blockReason && preview?.outcome === 'no-changes' && resolver.state.manualYaml === null) {
    blockReason = `Nothing to propose: version ${preview.target.version} already has these changes.`;
  }
  if (!blockReason) blockReason = fieldsError;

  const submit = async () => {
    if (!preview || blockReason || !resolver.submission()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(preview.target, resolver.resultYaml);
    } catch (caught) {
      setError(resolver.submissionFailed(caught));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PricingMergeResolver resolver={resolver} loadLatestYaml={loadLatestYaml} />
      {error && (
        <p role="alert" className="rounded-lg border border-tp-severity-error-border bg-tp-severity-error-bg px-3 py-2 text-sm text-tp-ink">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {blockReason && (
          <p id="apply-on-latest-block-reason" className="mr-auto text-xs text-tp-steel">
            {blockReason}
          </p>
        )}
        <button
          type="button"
          disabled={Boolean(blockReason) || isSubmitting}
          aria-describedby={blockReason ? 'apply-on-latest-block-reason' : undefined}
          onClick={submit}
          className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-50"
        >
          {isSubmitting ? 'Opening…' : submitLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Proposes the editor's text as a pull request on the version it was opened
 * on (the latest public one), or updates the open pull request the editor was
 * opened on. If a newer public version was published meanwhile, the text stays
 * as it is and the changes can be applied on top of the latest instead.
 */
export default function ProposeChangesModal({
  source,
  yaml,
  onClose,
}: {
  source: EditorSourcePricing & { pricingId: string; versionId: string };
  yaml: string;
  onClose: () => void;
}) {
  const { createPullRequest, editPullRequest, getPullRequest } = usePricingPullRequestsApi();
  const pullRequestId = source.pullRequestId;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server said a public version newer than the base was published.
  const [isBehind, setIsBehind] = useState(false);
  const [applyOnLatest, setApplyOnLatest] = useState(false);
  const [done, setDone] = useState<PullRequestWithWarnings | null>(null);

  // An update keeps the pull request's title and description unless they are changed here.
  useEffect(() => {
    if (!pullRequestId) return;
    let active = true;
    getPullRequest(pullRequestId)
      .then(open => {
        if (!active) return;
        setTitle(current => current || open.title);
        setDescription(current => current || open.description);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pullRequestId, getPullRequest]);

  const summary = useMemo(
    () => (source.baseYaml === undefined ? null : summarizeProposal(source.baseYaml, yaml)),
    [source.baseYaml, yaml]
  );
  const fieldsError = proposalFieldsError(title, description);
  let blockReason: string | null = null;
  if (summary?.isEmpty) blockReason = `Nothing to propose: the text is the same as version ${source.version}.`;
  else blockReason = fieldsError;

  const fields = {
    title: title.trim(),
    ...(description.trim() ? { description } : {}),
  };

  const open = async (base: PullRequestVersionRef, proposedYaml: string) => {
    setDone(
      await createPullRequest({
        ...fields,
        source: { kind: 'text', pricingId: source.pricingId, baseVersionId: base.id, proposedYaml },
      })
    );
  };

  const submit = async () => {
    if (blockReason) return;
    setIsSubmitting(true);
    setError(null);
    try {
      if (pullRequestId) {
        setDone(await editPullRequest(pullRequestId, { title: title.trim(), description, proposedYaml: yaml }));
      } else {
        await open({ id: source.versionId, version: source.version }, yaml);
      }
    } catch (caught) {
      if (!pullRequestId && caught instanceof PullRequestApiError && caught.code === 'BASE_NOT_LATEST') {
        setIsBehind(true);
      }
      setError(messageOf(caught));
      setIsSubmitting(false);
    }
  };

  const action = pullRequestId ? 'Update pull request' : 'Propose changes';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // While the changes are combined with the latest version, a click outside does not close
      // the dialog: the choices made there would go with it. Close and Cancel do.
      className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 pt-[8dvh] backdrop-blur-sm sm:p-4 sm:pt-[10dvh] ${
        applyOnLatest ? '' : 'cursor-pointer'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="propose-changes-title"
      onClick={applyOnLatest ? undefined : onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={`w-full cursor-default space-y-4 rounded-2xl border border-tp-hairline bg-tp-canvas p-5 shadow-elevation-4 sm:p-6 ${
          applyOnLatest ? 'max-w-[64rem]' : 'max-w-[42rem]'
        }`}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tp-primary text-tp-on-primary shadow-sm">
              <FiGitPullRequest aria-hidden="true" className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <h2 id="propose-changes-title" className="font-display text-lg font-semibold leading-tight text-tp-ink">
                {action}
              </h2>
              <p className="mt-0.5 truncate text-xs text-tp-steel">
                {source.name} · based on version {source.version}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-2 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
          >
            <FiX aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-tp-ink">
              <FiCheck aria-hidden="true" className="h-4 w-4 text-tp-severity-success" />
              Pull request #{done.number} {pullRequestId ? 'updated' : 'opened'}.
            </p>
            {done.warnings.map(warning => (
              <p key={warning.code} className="text-xs text-tp-steel">
                {pullRequestWarningMessage(warning)}
              </p>
            ))}
            <a
              href={pullRequestHref(source, done.id)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-tp-primary hover:underline"
            >
              View pull request #{done.number}
              <FiExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : (
          <>
            <ProposalFields title={title} description={description} onTitleChange={setTitle} onDescriptionChange={setDescription} />

            {applyOnLatest ? (
              <ApplyOnLatest
                source={source}
                yaml={yaml}
                fieldsError={fieldsError}
                submitLabel="Open pull request"
                onSubmit={open}
              />
            ) : (
              <>
                <ProposalSummary summary={summary} baseLabel={source.version} />
                {error && (
                  <div
                    role="alert"
                    className="space-y-2 rounded-lg border border-tp-severity-error-border bg-tp-severity-error-bg px-3 py-2 text-sm text-tp-ink"
                  >
                    <p className="flex items-start gap-2">
                      <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-tp-severity-error" />
                      <span>{error}</span>
                    </p>
                    {isBehind && (
                      <p className="text-xs text-tp-slate">
                        Your text in the editor stays as it is. You can combine your changes with the latest version and
                        resolve any conflicts before proposing them.
                      </p>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-tp-hairline pt-4">
                  {blockReason && (
                    <p id="propose-block-reason" className="mr-auto text-xs text-tp-steel">
                      {blockReason}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
                  >
                    Cancel
                  </button>
                  {isBehind ? (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setApplyOnLatest(true);
                      }}
                      className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
                    >
                      Apply my changes on top of the latest
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={Boolean(blockReason) || isSubmitting}
                      aria-describedby={blockReason ? 'propose-block-reason' : undefined}
                      onClick={submit}
                      className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-50"
                    >
                      {isSubmitting ? (pullRequestId ? 'Updating…' : 'Opening…') : action}
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
