import { useState } from 'react';
import type { IconType } from 'react-icons';
import {
  FiAlertTriangle,
  FiCheckCircle,
  FiGitMerge,
  FiMinusCircle,
  FiRefreshCw,
} from 'react-icons/fi';
import type {
  PullRequestDetail,
  PullRequestMergeResult,
  PullRequestVersionRef,
  PullRequestWithWarnings,
} from '../../types/pull-requests';
import MergePanel from './merge-panel';
import UpdatePanel from './update-panel';

type Tone = 'success' | 'warning' | 'neutral';

interface BoxStatus {
  tone: Tone;
  icon: IconType;
  title: string;
  text: string;
}

const TONES: Record<Tone, string> = {
  success: 'bg-tp-severity-success-bg text-tp-severity-success',
  warning: 'bg-tp-severity-warning-bg text-tp-severity-warning',
  neutral: 'bg-tp-surface text-tp-steel',
};

const conflicts = (count: number) => `${count} ${count === 1 ? 'conflict' : 'conflicts'}`;

/** What an open pull request's state means for merging it, worded for who reads it. */
function statusOf(
  pullRequest: PullRequestDetail,
  canMerge: boolean,
  canUpdate: boolean
): BoxStatus {
  const { state } = pullRequest;
  switch (state.kind) {
    case 'behind':
      if (state.conflicts === 0) {
        return {
          tone: 'success',
          icon: FiCheckCircle,
          title: 'No conflicts',
          text: 'A newer version was published after it was proposed, and both combine without conflicts.',
        };
      }
      return {
        tone: 'warning',
        icon: FiAlertTriangle,
        title: `${conflicts(state.conflicts)} with the latest version`,
        text: canMerge
          ? 'A newer version changed the same values: choose a side for each before merging.'
          : canUpdate
            ? 'A newer version changed the same values: update your proposal to it, choosing a side for each.'
            : 'A newer version changed the same values.',
      };
    case 'no-changes':
      return {
        tone: 'neutral',
        icon: FiMinusCircle,
        title: 'Nothing to merge',
        text: 'The latest version already has everything it proposes.',
      };
    case 'no-public-version':
      return {
        tone: 'warning',
        icon: FiAlertTriangle,
        title: 'No public version',
        text: 'This pricing has no public version to merge it into.',
      };
    default:
      return {
        tone: 'success',
        icon: FiCheckCircle,
        title: 'No conflicts',
        text: `It is based on version ${pullRequest.base.version}, the latest public one.`,
      };
  }
}

const PRIMARY =
  'cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep';
const SECONDARY =
  'cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface';

/**
 * What to do with an open pull request, right below its header so it is in view
 * however long its changes are: where it stands for merging (conflicts with the
 * latest version, nothing to merge...) and the one thing to do next, in one row.
 * A maintainer merges it (resolving its conflicts first, over the whole window),
 * its author brings it up to the latest version, and either can close it.
 * Merging and updating are confirmed here, in a second step that opens below.
 */
export default function MergeBox({
  pullRequest,
  isAuthor,
  etag,
  loadLatestYaml,
  onMerged,
  onUpdated,
  onPricingChanged,
  onClose,
}: {
  pullRequest: PullRequestDetail;
  isAuthor: boolean;
  etag?: string;
  loadLatestYaml: (target: PullRequestVersionRef) => Promise<string>;
  onMerged: (result: PullRequestMergeResult) => void;
  onUpdated: (pullRequest: PullRequestWithWarnings) => void;
  onPricingChanged: (error: unknown) => boolean;
  /** Asks how to close it (the close dialog). */
  onClose: () => void;
}) {
  const [step, setStep] = useState<{ kind: 'merge' | 'update'; resolveFirst: boolean } | null>(
    null
  );
  const { permissions, state } = pullRequest;
  const canMerge = permissions.merge && (state.kind === 'up-to-date' || state.kind === 'behind');
  const canUpdate = permissions.update;
  const known = state.kind === 'behind' ? state.conflicts : 0;
  const hasActions = permissions.close || canUpdate || canMerge;

  let status = statusOf(pullRequest, canMerge, canUpdate);
  if (step?.kind === 'merge') {
    status = {
      tone: 'neutral',
      icon: FiGitMerge,
      title: 'Merge pull request',
      text: 'Merging publishes the result as a new version of this pricing.',
    };
  } else if (step?.kind === 'update') {
    status = {
      tone: 'neutral',
      icon: FiRefreshCw,
      title: 'Update to the latest version',
      text: 'Your proposal is combined with the latest public version, which becomes the version it is based on.',
    };
  }
  const Icon = status.icon;

  return (
    <section aria-label="Merge" className="rounded-xl border border-tp-hairline bg-tp-canvas">
      {/* One row: where it stands on the left, what to do on the right (below it on narrow screens). */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONES[status.tone]}`}
          >
            <Icon aria-hidden="true" className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-tp-ink">{status.title}</h3>
            <p className="text-sm text-tp-slate">{status.text}</p>
            {!step && !permissions.merge && (
              <p className="mt-1 text-xs text-tp-steel">
                A maintainer of this pricing reviews and merges it.
              </p>
            )}
          </div>
        </div>

        {!step && hasActions && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {permissions.close && (
              <button type="button" onClick={onClose} className={SECONDARY}>
                {isAuthor ? 'Withdraw' : 'Close'}
              </button>
            )}
            {canUpdate && (
              <button
                type="button"
                onClick={() => setStep({ kind: 'update', resolveFirst: known > 0 })}
                className={canMerge ? SECONDARY : PRIMARY}
              >
                Update with latest version
              </button>
            )}
            {canMerge && (
              <button
                type="button"
                onClick={() => setStep({ kind: 'merge', resolveFirst: known > 0 })}
                className={PRIMARY}
              >
                {known > 0 ? 'Resolve conflicts' : 'Merge pull request'}
              </button>
            )}
          </div>
        )}
      </div>

      {step && (
        <div className="border-t border-tp-hairline p-4 sm:p-5">
          {step.kind === 'merge' ? (
            <MergePanel
              pullRequest={pullRequest}
              etag={etag}
              loadLatestYaml={loadLatestYaml}
              onPricingChanged={onPricingChanged}
              onCancel={() => setStep(null)}
              onMerged={onMerged}
              resolveFirst={step.resolveFirst}
            />
          ) : (
            <UpdatePanel
              pullRequest={pullRequest}
              loadLatestYaml={loadLatestYaml}
              onCancel={() => setStep(null)}
              onUpdated={onUpdated}
              resolveFirst={step.resolveFirst}
            />
          )}
        </div>
      )}
    </section>
  );
}
