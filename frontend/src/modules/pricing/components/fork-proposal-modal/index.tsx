import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiGitPullRequest, FiInfo, FiX } from 'react-icons/fi';
import PricingMergeResolver from '../../../core/components/pricing-merge-resolver';
import ProposalFields from '../../../core/components/proposal-fields';
import { useMergeResolver } from '../../../core/hooks/useMergeResolver';
import { usePricingVersionReader } from '../../../core/hooks/usePricingVersionReader';
import customAlert from '../../../core/utils/custom-alert';
import {
  proposalFieldsError,
  pullRequestMessage,
  pullRequestWarningMessage,
} from '../../../core/utils/pull-request-state';
import { usePricingPullRequestsApi } from '../../api/pricingPullRequestsApi';
import type { VersionData } from '../../types/card';
import type {
  ConflictResolutions,
  CreatedPullRequest,
  ForkTarget,
  PullRequestVersionRef,
} from '../../types/pull-requests';

type ForkOrigin = NonNullable<VersionData['forkedFrom']>;

/** Where the pricing a fork proposes to lives, to open its pull request once proposed. */
export interface ForkParentLocation {
  organizationId: string;
  slug: string;
  collectionSlug: string | null;
}

/**
 * The fork's latest version proposed to the pricing it came from: the three-way
 * merge against that pricing's latest public version, resolved here (or typed
 * by hand in the YAML view), with a title and a description. When the caller
 * already has a pull request open from this fork, proposing again replaces its
 * proposal.
 */
function ForkProposalDialog({
  forkPricingId,
  target,
  location,
  onClose,
  onProposed,
}: {
  forkPricingId: string;
  target: ForkTarget & { parent: NonNullable<ForkTarget['parent']> };
  location: ForkParentLocation;
  onClose: () => void;
  onProposed: (pullRequest: CreatedPullRequest) => void;
}) {
  const { previewProposal, createPullRequest, getPullRequest } = usePricingPullRequestsApi();
  const readVersion = usePricingVersionReader();
  // The author may type their proposal by hand in the YAML view; the fork does not change.
  const resolver = useMergeResolver(
    useCallback(
      (resolutions: ConflictResolutions) => previewProposal({ kind: 'fork', forkPricingId }, resolutions),
      [previewProposal, forkPricingId]
    ),
    { editable: true }
  );
  const { parent } = target;
  const loadLatestYaml = useCallback(
    (version: PullRequestVersionRef) => readVersion({ ...location, pricingId: parent.pricingId }, version),
    [readVersion, location, parent.pricingId]
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { preview } = resolver;
  const replaces = preview?.existingPullRequest ?? target.openPullRequest;
  const ownOpenId = target.openPullRequest?.id;

  // Proposing again keeps the title and description of the pull request it replaces, unless they are changed here.
  useEffect(() => {
    if (!ownOpenId) return;
    let active = true;
    getPullRequest(ownOpenId)
      .then(open => {
        if (!active) return;
        setTitle(current => current || open.title);
        setDescription(current => current || open.description);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ownOpenId, getPullRequest]);

  let blockReason = resolver.blockReason;
  // What the merge computed; a text typed by hand is checked by the server when it is sent.
  if (!blockReason && !resolver.isManual && preview?.outcome === 'no-changes') {
    blockReason = `Nothing to propose: version ${preview.target.version} of ${parent.name} already has everything this fork changes.`;
  }
  if (!blockReason) blockReason = proposalFieldsError(title, description);

  const submit = async () => {
    const submission = resolver.submission();
    if (!submission || blockReason) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const proposed = await createPullRequest({
        title: title.trim(),
        ...(description.trim() ? { description } : {}),
        source: { kind: 'fork', forkPricingId },
        ...submission,
      });
      const notices = proposed.warnings.map(pullRequestWarningMessage).join(' ');
      customAlert(
        `${proposed.updated ? `Pull request #${proposed.number} updated` : `Pull request #${proposed.number} opened`} on ${parent.name}.${notices ? ` ${notices}` : ''}`,
        'success'
      );
      onProposed(proposed);
    } catch (caught) {
      setError(resolver.submissionFailed(caught));
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      // A click outside does not close it: the choices, the title and the description would
      // go with it. Close and Cancel do.
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-tp-ink/60 p-3 pt-[6dvh] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fork-proposal-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        // One height whatever the view shows (from sm up; on phones the views share a fixed area),
        // so switching views never moves the dialog: the views scroll inside it.
        className="flex w-full max-w-[64rem] cursor-default flex-col gap-5 rounded-2xl border border-tp-hairline bg-tp-canvas p-5 shadow-elevation-4 sm:h-[min(88dvh,60rem)] sm:p-6"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="fork-proposal-title" className="break-words font-display text-lg font-semibold text-tp-ink">
              Propose changes to {parent.name}
            </h2>
            <p className="mt-0.5 text-xs text-tp-steel">
              The latest version of this fork, merged with the latest public version of {parent.name}. The fork does not
              change.
            </p>
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

        {replaces && (
          <p className="flex shrink-0 items-start gap-2 rounded-lg border border-tp-severity-info-border bg-tp-severity-info-bg px-3 py-2 text-xs text-tp-ink">
            <FiInfo aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tp-severity-info" />
            <span>Replaces the current proposal of #{replaces.number}.</span>
          </p>
        )}

        <div className="h-[30rem] min-h-0 sm:h-auto sm:min-h-[16rem] sm:flex-1">
          <PricingMergeResolver resolver={resolver} loadLatestYaml={loadLatestYaml} purpose="propose" fill />
        </div>

        <div className="shrink-0">
          <ProposalFields title={title} description={description} onTitleChange={setTitle} onDescriptionChange={setDescription} />
        </div>

        {error && (
          <p role="alert" className="shrink-0 rounded-lg border border-tp-severity-error-border bg-tp-severity-error-bg px-3 py-2 text-sm text-tp-ink">
            {error}
          </p>
        )}

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-tp-hairline pt-4">
          {blockReason && (
            <p id="fork-proposal-block-reason" className="mr-auto text-xs text-tp-steel">
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
          <button
            type="button"
            disabled={Boolean(blockReason) || isSubmitting}
            aria-describedby={blockReason ? 'fork-proposal-block-reason' : undefined}
            onClick={submit}
            className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-50"
          >
            {isSubmitting ? 'Proposing…' : replaces ? `Update pull request #${replaces.number}` : 'Open pull request'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * "Propose changes to <parent>" on a fork: shown to who may publish versions of
 * the fork, when one of its versions names the pricing it was forked from and
 * its latest version changes something of the parent's latest public one.
 * Whether it can propose now comes from the server, which answers only on the
 * versions of the fork the caller may read; when it cannot for another reason,
 * the button stays disabled with the reason written next to it.
 */
export default function ForkProposal({
  forkPricingId,
  forkedFrom,
  canCreate,
  latestVersionId,
  onProposed,
}: {
  forkPricingId: string;
  /** The origin named by the newest version of the fork that has one. */
  forkedFrom: ForkOrigin | null;
  /** CREATE on the fork, as the page's permissions say. */
  canCreate: boolean;
  /** The fork's newest version on the page: a new one may change whether there is something to propose. */
  latestVersionId?: string;
  onProposed: (pullRequest: CreatedPullRequest, parent: ForkParentLocation) => void;
}) {
  const { getForkTarget } = usePricingPullRequestsApi();
  // null while asking; 'hidden' when the server refuses (no CREATE, or the fork is not readable).
  const [target, setTarget] = useState<ForkTarget | 'hidden' | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const isCandidate = Boolean(forkedFrom && canCreate);

  useEffect(() => {
    setTarget(null);
    if (!isCandidate) return;
    let active = true;
    getForkTarget(forkPricingId)
      .then(result => {
        if (active) setTarget(result);
      })
      .catch(() => {
        if (active) setTarget('hidden');
      });
    return () => {
      active = false;
    };
  }, [isCandidate, forkPricingId, latestVersionId, getForkTarget]);

  // Hidden too while the fork has nothing the parent's latest public version lacks: there is nothing to propose.
  if (
    !isCandidate ||
    !forkedFrom ||
    target === null ||
    target === 'hidden' ||
    target.reason === 'NOT_A_FORK' ||
    target.reason === 'NO_CHANGES'
  ) {
    return null;
  }

  const parentName = target.parent?.name ?? forkedFrom.name;
  const reason = target.canPropose
    ? null
    : pullRequestMessage(target.reason, { number: target.openPullRequest?.number });
  const parent = target.canPropose ? target.parent : undefined;
  // The collection the fork was made from, while the origin it names is still that pricing.
  const location: ForkParentLocation | null = parent
    ? {
        organizationId: parent.organizationId,
        slug: parent.slug,
        collectionSlug:
          forkedFrom.pricingId === parent.pricingId && forkedFrom.slug === parent.slug
            ? (forkedFrom.collectionSlug ?? null)
            : null,
      }
    : null;
  const label = target.canPropose && target.openPullRequest
    ? `Update pull request #${target.openPullRequest.number}`
    : `Propose changes to ${parentName}`;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        disabled={!parent}
        aria-describedby={reason ? 'fork-proposal-reason' : undefined}
        onClick={() => setIsOpen(true)}
        className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-tp-input-border bg-tp-input-bg px-2.5 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface disabled:cursor-default disabled:opacity-50"
      >
        <FiGitPullRequest aria-hidden="true" className="h-3.5 w-3.5 text-tp-primary" />
        {label}
      </button>
      {reason && (
        <p id="fork-proposal-reason" className="text-xs text-tp-steel">
          {reason}
        </p>
      )}
      <AnimatePresence>
        {isOpen && parent && location && (
          <ForkProposalDialog
            forkPricingId={forkPricingId}
            target={{ ...target, parent }}
            location={location}
            onClose={() => setIsOpen(false)}
            onProposed={pullRequest => {
              setIsOpen(false);
              onProposed(pullRequest, location);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
