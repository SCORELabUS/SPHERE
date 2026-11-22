import { FiUploadCloud } from 'react-icons/fi';
import { pullRequestMessage } from '../../../core/utils/pull-request-state';
import type { PullRequestList, PullRequestVersionRef } from '../../types/pull-requests';

/**
 * "Upload proposal": a YAML file proposed as the next version of the latest
 * public one. Pull requests are reviewed here, not written: they come from an
 * uploaded file or from a fork. When the caller cannot open one now, the button
 * is disabled and the reason is written next to it.
 */
export default function ProposeMenu({
  proposals,
  onUpload,
}: {
  proposals: PullRequestList['proposals'];
  onUpload: (latest: PullRequestVersionRef) => void;
}) {
  const { latest } = proposals;
  const reason = !proposals.canOpen
    ? pullRequestMessage(proposals.reason)
    : !latest
      ? pullRequestMessage('NO_PUBLIC_VERSION')
      : null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {reason && (
        <p id="propose-block-reason" className="text-xs text-tp-steel">
          {reason}
        </p>
      )}
      <button
        type="button"
        disabled={Boolean(reason)}
        aria-describedby={reason ? 'propose-block-reason' : undefined}
        title={latest && !reason ? `Propose a YAML file as the next version of ${latest.version}` : undefined}
        onClick={() => latest && onUpload(latest)}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-3 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-50"
      >
        <FiUploadCloud aria-hidden="true" className="h-3.5 w-3.5" />
        Upload proposal
      </button>
    </div>
  );
}
