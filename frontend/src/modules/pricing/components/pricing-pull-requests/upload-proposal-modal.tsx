import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import jsYaml from 'js-yaml';
import { retrievePricingFromYaml } from 'pricing4ts';
import { FiX } from 'react-icons/fi';
import FileUpload from '../../../core/components/file-upload-input';
import ProposalSummary from '../../../core/components/proposal-summary';
import customAlert from '../../../core/utils/custom-alert';
import ProposalFields from '../../../core/components/proposal-fields';
import {
  proposalFieldsError,
  pullRequestMessage,
  pullRequestWarningMessage,
} from '../../../core/utils/pull-request-state';
import { PullRequestApiError, usePricingPullRequestsApi } from '../../api/pricingPullRequestsApi';
import { summarizeProposal } from '../../utils/proposal-summary';
import type { PullRequestDetail, PullRequestVersionRef } from '../../types/pull-requests';

/**
 * Whether a file can be proposed as it is. A file in the latest Pricing2Yaml
 * syntax must pass the parser here; one in an older syntax is sent as it is,
 * since only SPHERE upgrades it (and says so).
 */
function checkUpload(text: string): string | null {
  let document: unknown;
  try {
    document = jsYaml.load(text);
  } catch (caught) {
    return `The file is not valid YAML: ${(caught as Error).message}`;
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return 'The file is not a Pricing2Yaml pricing.';
  }
  if (String((document as Record<string, unknown>).syntaxVersion) !== '3.1') return null;
  try {
    retrievePricingFromYaml(text);
    return null;
  } catch (caught) {
    return `The file is not a valid pricing: ${(caught as Error).message}`;
  }
}

/**
 * Proposes a YAML file as a pull request on the latest public version of the
 * pricing: what it changes against that version (removals called out), a title
 * and a description. The new version's visibility is not chosen here: only the
 * maintainer who merges it decides.
 */
export default function UploadProposalModal({
  pricingId,
  latest,
  loadLatestYaml,
  onCreated,
  onClose,
}: {
  pricingId: string;
  latest: PullRequestVersionRef;
  loadLatestYaml: (target: PullRequestVersionRef) => Promise<string>;
  onCreated: (pullRequest: PullRequestDetail) => void;
  onClose: () => void;
}) {
  const { createPullRequest } = usePricingPullRequestsApi();
  // The version proposed on: the latest public one, or a newer one the server named when refusing.
  const [base, setBase] = useState(latest);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [latestYaml, setLatestYaml] = useState<{ yaml?: string; error?: string } | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLatestYaml(null);
    loadLatestYaml(base)
      .then(yaml => {
        if (active) setLatestYaml({ yaml });
      })
      .catch((caught: unknown) => {
        if (active) setLatestYaml({ error: caught instanceof Error ? caught.message : 'it could not be read.' });
      });
    return () => {
      active = false;
    };
  }, [base, loadLatestYaml]);

  const summary = useMemo(
    () => (file && latestYaml?.yaml !== undefined ? summarizeProposal(latestYaml.yaml, file.text) : undefined),
    [file, latestYaml]
  );

  const pick = async (picked: File) => {
    const text = await picked.text();
    const problem = checkUpload(text);
    setError(null);
    setFileError(problem);
    setFile(problem ? null : { name: picked.name, text });
  };

  let blockReason: string | null = null;
  if (!file) blockReason = 'Choose a Pricing2Yaml file to propose.';
  else if (summary?.isEmpty) blockReason = `Nothing to propose: the file is the same as version ${base.version}.`;
  else blockReason = proposalFieldsError(title, description);

  const submit = async () => {
    if (!file || blockReason) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const created = await createPullRequest({
        title: title.trim(),
        ...(description.trim() ? { description } : {}),
        source: { kind: 'text', pricingId, baseVersionId: base.id, proposedYaml: file.text },
      });
      const notices = created.warnings.map(pullRequestWarningMessage).join(' ');
      customAlert(`Pull request #${created.number} opened.${notices ? ` ${notices}` : ''}`, 'success');
      onCreated(created);
    } catch (caught) {
      let message =
        caught instanceof PullRequestApiError
          ? pullRequestMessage(caught.code, { message: caught.message, latest: caught.latest })
          : pullRequestMessage(null);
      // A newer public version: the file is compared with it, and can be proposed on it after a look.
      if (caught instanceof PullRequestApiError && caught.code === 'BASE_NOT_LATEST' && caught.latest && caught.latest.id !== base.id) {
        setBase(caught.latest);
        message += ` The proposal now starts from version ${caught.latest.version}: review its changes and open it again.`;
      }
      setError(message);
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex cursor-pointer items-start justify-center overflow-y-auto bg-tp-ink/60 p-3 pt-[8dvh] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-proposal-title"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-[42rem] cursor-default space-y-4 rounded-2xl border border-tp-hairline bg-tp-canvas p-5 shadow-elevation-4 sm:p-6"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="upload-proposal-title" className="font-display text-lg font-semibold text-tp-ink">
              Propose a YAML file
            </h2>
            <p className="mt-0.5 text-xs text-tp-steel">
              The pull request is based on version {base.version}, the latest public version.
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

        {file ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-tp-hairline bg-tp-surface px-3 py-2 text-xs">
            <span className="min-w-0 truncate font-medium text-tp-ink">{file.name}</span>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="shrink-0 cursor-pointer font-medium text-tp-primary hover:underline"
            >
              Choose another file
            </button>
          </div>
        ) : (
          <FileUpload
            onSubmit={picked => void pick(picked)}
            submitButtonText="Use this file"
            isDragActiveText="Drop the Pricing2Yaml file here"
            isNotDragActiveText="Drag and drop a Pricing2Yaml file here"
          />
        )}
        {fileError && (
          <p role="alert" className="rounded-lg border border-tp-severity-error-border bg-tp-severity-error-bg px-3 py-2 text-xs text-tp-ink">
            {fileError}
          </p>
        )}

        {file &&
          (latestYaml === null ? (
            <p className="text-xs text-tp-steel">Reading version {base.version}…</p>
          ) : latestYaml.yaml === undefined ? (
            <p className="text-xs text-tp-steel">
              Version {base.version} could not be read to compare: {latestYaml.error}
            </p>
          ) : (
            <ProposalSummary summary={summary ?? null} baseLabel={base.version} />
          ))}

        <ProposalFields title={title} description={description} onTitleChange={setTitle} onDescriptionChange={setDescription} />

        {error && (
          <p role="alert" className="rounded-lg border border-tp-severity-error-border bg-tp-severity-error-bg px-3 py-2 text-sm text-tp-ink">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-tp-hairline pt-4">
          {blockReason && (
            <p id="upload-block-reason" className="mr-auto text-xs text-tp-steel">
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
            aria-describedby={blockReason ? 'upload-block-reason' : undefined}
            onClick={submit}
            className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-50"
          >
            {isSubmitting ? 'Opening…' : 'Open pull request'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
