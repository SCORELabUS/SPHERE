import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FiChevronDown, FiCode, FiEdit3, FiGitPullRequest, FiUploadCloud } from 'react-icons/fi';
import { pullRequestMessage } from '../../../core/utils/pull-request-state';
import type { PullRequestList, PullRequestVersionRef } from '../../types/pull-requests';

interface Option {
  key: string;
  title: string;
  description: string;
  icon: ReactNode;
  onSelect: () => void;
}

/**
 * "Propose changes": opens the latest public version in the visual or code
 * editor, or takes a YAML file, as a pull request on it. When the caller cannot
 * open one now, the button is disabled and the reason is written next to it.
 */
export default function ProposeMenu({
  proposals,
  onEditor,
  onUpload,
}: {
  proposals: PullRequestList['proposals'];
  onEditor: (latest: PullRequestVersionRef, mode: 'visual' | 'code') => void;
  onUpload: (latest: PullRequestVersionRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { latest } = proposals;
  const reason = !proposals.canOpen
    ? pullRequestMessage(proposals.reason)
    : !latest
      ? pullRequestMessage('NO_PUBLIC_VERSION')
      : null;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const options: Option[] = latest
    ? [
        {
          key: 'visual',
          title: 'Visual editor',
          description: `Edit version ${latest.version} visually`,
          icon: <FiEdit3 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-tp-primary" />,
          onSelect: () => onEditor(latest, 'visual'),
        },
        {
          key: 'code',
          title: 'Code editor',
          description: `Edit the YAML of version ${latest.version}`,
          icon: <FiCode aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-tp-primary" />,
          onSelect: () => onEditor(latest, 'code'),
        },
        {
          key: 'upload',
          title: 'Upload YAML',
          description: `Propose a file as the next version of ${latest.version}`,
          icon: <FiUploadCloud aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-tp-primary" />,
          onSelect: () => onUpload(latest),
        },
      ]
    : [];

  return (
    <div ref={menuRef} className="relative flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {reason && (
        <p id="propose-block-reason" className="text-xs text-tp-steel">
          {reason}
        </p>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={Boolean(reason)}
        aria-describedby={reason ? 'propose-block-reason' : undefined}
        onClick={() => setOpen(value => !value)}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-tp-primary px-3 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-50"
      >
        <FiGitPullRequest aria-hidden="true" className="h-3.5 w-3.5" />
        Propose changes
        <FiChevronDown aria-hidden="true" className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && !reason && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-xl border border-tp-hairline bg-tp-canvas p-1.5 shadow-elevation-3"
        >
          {options.map(option => (
            <button
              key={option.key}
              type="button"
              role="menuitem"
              onClick={() => {
                option.onSelect();
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-left text-xs text-tp-ink hover:bg-tp-surface"
            >
              {option.icon}
              <span>
                <span className="block font-medium">{option.title}</span>
                <span className="mt-0.5 block text-[11px] text-tp-steel">{option.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
