import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { FiExternalLink, FiGitPullRequest, FiInfo } from 'react-icons/fi';
import { canProposeFromEditor, pullRequestMessage } from '../../../core/utils/pull-request-state';
import { usePricingPullRequestsApi } from '../../../pricing/api/pricingPullRequestsApi';
import type { PullRequestList } from '../../../pricing/types/pull-requests';
import type { EditorSourcePricing } from '../../contexts/editorValueContext';
import { editorPath } from '../../utils/editor-source';
import ProposeChangesModal from './propose-changes-modal';

/**
 * "Propose changes" next to Publish: a pull request with the editor's text on
 * the version it was opened on, active only when that version is (by id) the
 * latest public one; otherwise disabled, with the reason and a link that opens
 * the latest public version in another tab, so the text here is kept. An editor
 * opened on an open pull request offers "Update pull request" instead.
 */
export default function ProposeChangesButton({ source, yaml }: { source: EditorSourcePricing; yaml: string }) {
  const { listPullRequests } = usePricingPullRequestsApi();
  const [proposals, setProposals] = useState<PullRequestList['proposals'] | 'failed' | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const reasonRef = useRef<HTMLDivElement>(null);
  const { pricingId, pullRequestId } = source;

  useEffect(() => {
    setProposals(null);
    if (!pricingId || pullRequestId) return;
    let active = true;
    listPullRequests(pricingId, { status: 'open' })
      .then(result => {
        if (active) setProposals(result.proposals);
      })
      .catch(() => {
        if (active) setProposals('failed');
      });
    return () => {
      active = false;
    };
  }, [pricingId, pullRequestId, listPullRequests]);

  useEffect(() => {
    if (!showReason) return;
    const close = (event: MouseEvent) => {
      if (!reasonRef.current?.contains(event.target as Node)) setShowReason(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showReason]);

  if (!pricingId) return null;

  const latest = proposals && proposals !== 'failed' ? proposals.latest : null;
  let reason: string | null = null;
  if (!pullRequestId) {
    if (proposals === null) reason = 'Checking whether you can propose changes…';
    else if (proposals === 'failed') reason = 'Pull requests are not available for this pricing right now.';
    else if (!proposals.canOpen) reason = pullRequestMessage(proposals.reason);
    else if (!canProposeFromEditor(source, latest)) {
      reason = `Pull requests start from the latest public version${latest ? ` (${latest.version})` : ''}, and this editor holds version ${source.version}.`;
    }
  }
  // The latest public version, offered when it is the version that is missing.
  const latestHref =
    latest && reason && proposals !== 'failed' && proposals?.canOpen
      ? `${import.meta.env.BASE_URL.replace(/\/$/, '')}${editorPath(source, latest)}`
      : null;
  const label = pullRequestId ? 'Update pull request' : 'Propose changes';
  const { versionId } = source;

  return (
    <div ref={reasonRef} className="relative flex items-center">
      <button
        type="button"
        disabled={Boolean(reason)}
        aria-label={label}
        title={reason ?? undefined}
        onClick={() => setIsOpen(true)}
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-white/75 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-50 disabled:hover:border-white/15 disabled:hover:bg-transparent"
      >
        <FiGitPullRequest aria-hidden="true" className="h-4 w-4" />
        <span className="hidden sm:inline">{label}</span>
      </button>
      {reason && (
        <button
          type="button"
          aria-label="Why proposing changes is not available"
          aria-expanded={showReason}
          onClick={() => setShowReason(value => !value)}
          className="ml-0.5 cursor-pointer rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <FiInfo aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
      {reason && showReason && (
        <div
          role="note"
          className="absolute right-0 top-full z-50 mt-2 w-72 space-y-2 rounded-lg border border-white/10 bg-tp-surface-code p-3 text-xs text-white/75 shadow-elevation-4"
        >
          <p>{reason}</p>
          {latestHref && latest && (
            <a
              href={latestHref}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-white underline decoration-white/40 underline-offset-2 hover:decoration-white"
            >
              Open latest version ({latest.version})
              <FiExternalLink aria-hidden="true" className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
      <AnimatePresence>
        {isOpen && !reason && versionId && (
          <ProposeChangesModal
            source={{ ...source, pricingId, versionId }}
            yaml={yaml}
            onClose={() => setIsOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
