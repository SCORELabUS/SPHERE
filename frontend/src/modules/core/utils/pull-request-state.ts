import type {
  ForkProposalBlock,
  ProposalBlock,
  PullRequestErrorCode,
  PullRequestSummary,
  PullRequestWarning,
} from '../../pricing/types/pull-requests';

/** The colour family of a state chip: the `--color-tp-severity-*` tokens it maps to. */
export type PullRequestTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

/** Which icon a state chip shows next to its text. */
export type PullRequestStateIcon =
  | 'merged'
  | 'closed'
  | 'no-public-version'
  | 'up-to-date'
  | 'no-changes'
  | 'can-merge'
  | 'conflicts';

export interface PullRequestStateView {
  label: string;
  icon: PullRequestStateIcon;
  tone: PullRequestTone;
}

/** The text, icon and tone of a pull request's state, as its chip shows them. */
export function describePullRequestState(
  pullRequest: Pick<PullRequestSummary, 'state' | 'merged'>
): PullRequestStateView {
  const { state } = pullRequest;
  switch (state.kind) {
    case 'merged': {
      // The merged version is only named to who may read it.
      const version = pullRequest.merged?.version;
      return { label: version ? `Merged as ${version}` : 'Merged', icon: 'merged', tone: 'success' };
    }
    case 'closed':
      return { label: 'Closed', icon: 'closed', tone: 'neutral' };
    case 'no-public-version':
      return { label: 'No public version', icon: 'no-public-version', tone: 'warning' };
    case 'up-to-date':
      return { label: 'Up to date', icon: 'up-to-date', tone: 'info' };
    case 'no-changes':
      return { label: 'No changes', icon: 'no-changes', tone: 'neutral' };
    case 'behind':
      return state.conflicts === 0
        ? { label: 'Behind · can merge', icon: 'can-merge', tone: 'info' }
        : {
            label: `Behind · ${state.conflicts} ${state.conflicts === 1 ? 'conflict' : 'conflicts'}`,
            icon: 'conflicts',
            tone: 'warning',
          };
  }
}

/** Who opened a pull request, or "Deleted user" once their account is gone. */
export function pullRequestAuthorName(author: PullRequestSummary['author']): string {
  return author?.username ?? 'Deleted user';
}

/**
 * Whether the editor may propose its text as a pull request: only when it was
 * opened on the latest public version, compared by id. A label can be reused
 * by a version deleted and created again, and an editor opened without a
 * version id (it falls back to the newest version it can read) proposes nothing.
 */
export function canProposeFromEditor(
  source: { versionId?: string | null } | null | undefined,
  latest: { id: string } | null | undefined
): boolean {
  return Boolean(source?.versionId && latest?.id && source.versionId === latest.id);
}

/** The longest title and description a pull request keeps, as the API checks them. */
export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 10_000;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Why a pull request's title and description cannot be sent as they are; null when they can. */
export function proposalFieldsError(title: string, description: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return 'Give the pull request a title.';
  if (trimmed.length > MAX_TITLE_LENGTH) return `The title is longer than ${MAX_TITLE_LENGTH} characters.`;
  if (CONTROL_CHARACTERS.test(trimmed)) return 'The title cannot contain control characters.';
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `The description is longer than ${MAX_DESCRIPTION_LENGTH.toLocaleString('en')} characters.`;
  }
  return null;
}

/** What SPHERE did, or will do, to a proposal or a merge result, in words. */
export function pullRequestWarningMessage(warning: PullRequestWarning): string {
  switch (warning.code) {
    case 'SYNTAX_UPGRADED':
      return 'Some of these pricings were written in an older Pricing2Yaml syntax: SPHERE compares them, and writes the result, in the latest one.';
    case 'FORMAT_REGENERATED':
      return 'The result combines both sides, so SPHERE writes its YAML again: comments and the original layout are not kept.';
    case 'MANUAL_OVERRIDE':
      return 'The result was edited by hand: it replaces the computed merge.';
    case 'GLOBAL_FIELD_CHANGED':
      return `The current version changed ${warning.fields.join(', ')} and the proposal changes prices: check that they still mean what the proposal intended.`;
    case 'PREVIOUSLY_MERGED':
      return `Pull request #${warning.number} from this fork was merged before.`;
  }
}

/** What a refusal or a reason not to propose may carry to word its message. */
export interface PullRequestMessageDetails {
  /** The server's own message: the parser's text, the size limit, the label taken… */
  message?: string;
  latest?: { version: string } | null;
  number?: number;
}

type MessageCode = PullRequestErrorCode | ProposalBlock | ForkProposalBlock;

const FALLBACK_MESSAGE = 'Something went wrong with the pull request. Try again.';

const serverOr = (fallback: string) => (details: PullRequestMessageDetails) => details.message || fallback;

/** One message per code, so the compiler points at any code the API adds. */
const MESSAGES: Record<MessageCode, (details: PullRequestMessageDetails) => string> = {
  WEB_SESSION_REQUIRED: () => 'Sign in to SPHERE to work with pull requests.',
  NOT_FOUND: () => 'This pull request is not available.',
  FORBIDDEN: serverOr('You are not allowed to do this with this pull request.'),
  LIMIT_REACHED: () => 'You cannot open more pull requests on this pricing for now.',
  AUTHOR_LIMIT: () => 'You have reached the limit of open pull requests on this pricing.',
  PRICING_LIMIT: () => 'This pricing has reached its limit of open pull requests.',
  DAILY_LIMIT: () => 'You have opened as many pull requests as allowed in a day. Try again later.',
  NO_PUBLIC_VERSION: () => 'This pricing has no public version to propose changes to.',
  BASE_NOT_LATEST: ({ latest }) =>
    latest
      ? `A newer public version (${latest.version}) was published. Proposals start from the latest public version.`
      : 'A newer public version was published. Proposals start from the latest public version.',
  NO_CHANGES: () => 'Nothing to propose: the proposal is the same as the latest public version.',
  INVALID_PRICING: serverOr('The pricing is not valid.'),
  PRICING_TOO_LARGE: serverOr('The pricing is too large.'),
  PRICING_TOO_COMPLEX: () => 'The pricing is too complex to process: it nests or repeats too many values.',
  PRICING_SYNTAX_UNSUPPORTED: serverOr('The pricing is written in a syntax SPHERE cannot upgrade.'),
  PULL_REQUEST_NOT_OPEN: () => 'This pull request is no longer open.',
  PULL_REQUEST_MERGING: () => 'This pull request is being merged right now. Try again in a moment.',
  PULL_REQUEST_BEHIND: () =>
    'A newer public version was published. Update the pull request to the latest before changing its proposal.',
  PULL_REQUEST_CHANGED: () => 'The pull request changed while you were saving. Reload it and try again.',
  PULL_REQUEST_UP_TO_DATE: () => 'The pull request already starts from the latest public version.',
  PULL_REQUEST_EXISTS: ({ number }) =>
    number !== undefined ? `Pull request #${number} is already open` : 'A pull request from this fork is already open',
  PREVIEW_STALE: () => 'Something changed since the preview was computed. Review the new preview and try again.',
  NOT_A_FORK: () => 'This pricing is not a fork of another pricing.',
  PARENT_UNAVAILABLE: () => 'The pricing this fork comes from is not available.',
  UNRESOLVED_CONFLICTS: () => 'Choose a side for every conflict.',
  UNKNOWN_RESOLUTION: () => 'Some choices no longer match the conflicts. Review them again.',
  VERSION_TAKEN: serverOr('That version already exists. Choose another label.'),
  PRICING_CHANGED_DURING_MERGE: () => 'The pricing changed while merging. Review the merge again.',
  PRECONDITION_FAILED: () =>
    'Someone else changed this pricing since you opened it. Reload the page to see the latest version, then try again.',
  MERGE_FAILED: () => 'The merged version could not be published. Try again.',
};

const isMessageCode = (code: string): code is MessageCode => Object.prototype.hasOwnProperty.call(MESSAGES, code);

/**
 * The message for a pull request error code or a reason not to propose. An
 * unknown code (or none) shows the server's message.
 */
export function pullRequestMessage(code: string | null | undefined, details: PullRequestMessageDetails = {}): string {
  if (code && isMessageCode(code)) return MESSAGES[code](details);
  return details.message || FALLBACK_MESSAGE;
}
