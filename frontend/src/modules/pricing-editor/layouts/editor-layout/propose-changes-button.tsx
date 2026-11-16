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
 *
 * `readYaml` gives the text the user sees, the visual editor's unsaved draft
 * included; it is read when the dialog opens and kept while it is open.
 */
export default function ProposeChangesButton({ source, readYaml }: { source: EditorSourcePricing; readYaml: () => string }) {
  const { listPullRequests } = usePricingPullRequestsApi();
  const [proposals, setProposals] = useState<PullRequestList['proposals'] | 'failed' | null>(null);
  // The text proposed, taken when the dialog opens; null while it is closed.
  const [yaml, setYaml] = useState<string | null>(null);
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

  // On narrow screens the reason hangs from the editor's header (sticky, so positioned), across
  // its whole width: hung from this button it would start off the left edge of a phone.
  return (
    <div ref={reasonRef} className="flex items-center sm:relative">
      <button
        type="button"
        disabled={Boolean(reason)}
        aria-label={label}
        title={reason ?? label}
        onClick={() => setYaml(readYaml())}
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-white/75 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-50 disabled:hover:border-white/15 disabled:hover:bg-transparent"
      >
        <FiGitPullRequest aria-hidden="true" className="h-4 w-4" />
        {/* Only an icon below 2xl, where the editor's header has no room for the words (named by aria-label and title). */}
        <span className="hidden 2xl:inline">{label}</span>
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
          className="absolute inset-x-3 top-full z-50 mt-2 space-y-2 break-words rounded-lg border border-white/10 bg-tp-surface-code p-3 text-xs text-white/75 shadow-elevation-4 sm:inset-x-auto sm:right-0 sm:w-72"
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
        {yaml !== null && !reason && versionId && (
          <ProposeChangesModal
            source={{ ...source, pricingId, versionId }}
            yaml={yaml}
            onClose={() => setYaml(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
