import type { IconType } from 'react-icons';
import {
  FiAlertTriangle,
  FiCheckCircle,
  FiEyeOff,
  FiGitMerge,
  FiGitPullRequest,
  FiMinusCircle,
  FiXCircle,
} from 'react-icons/fi';
import {
  describePullRequestState,
  type PullRequestStateIcon,
  type PullRequestTone,
} from '../../../core/utils/pull-request-state';
import type { PullRequestSummary } from '../../types/pull-requests';

const ICONS: Record<PullRequestStateIcon, IconType> = {
  merged: FiGitMerge,
  closed: FiXCircle,
  'no-public-version': FiEyeOff,
  'up-to-date': FiCheckCircle,
  'no-changes': FiMinusCircle,
  'can-merge': FiGitPullRequest,
  conflicts: FiAlertTriangle,
};

// The label stays in ink so it reads on every tone; the icon and frame carry the colour.
const TONES: Record<PullRequestTone, { chip: string; icon: string }> = {
  success: {
    chip: 'border-tp-severity-success-border bg-tp-severity-success-bg',
    icon: 'text-tp-severity-success',
  },
  info: { chip: 'border-tp-severity-info-border bg-tp-severity-info-bg', icon: 'text-tp-severity-info' },
  warning: {
    chip: 'border-tp-severity-warning-border bg-tp-severity-warning-bg',
    icon: 'text-tp-severity-warning',
  },
  danger: { chip: 'border-tp-severity-error-border bg-tp-severity-error-bg', icon: 'text-tp-severity-error' },
  neutral: { chip: 'border-tp-hairline-strong bg-tp-surface', icon: 'text-tp-steel' },
};

/** Where a pull request stands, with an icon and its text (never colour alone). */
export default function StateChip({ pullRequest }: { pullRequest: Pick<PullRequestSummary, 'state' | 'merged'> }) {
  const { label, icon, tone } = describePullRequestState(pullRequest);
  const Icon = ICONS[icon];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium text-tp-ink ${TONES[tone].chip}`}
    >
      <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${TONES[tone].icon}`} />
      {label}
    </span>
  );
}
