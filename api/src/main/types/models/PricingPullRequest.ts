/**
 * A pull request proposes a new version of a pricing (P). It always targets the
 * latest public version of P, and merging it publishes that version through
 * `PricingService.createVersion`. "Behind" and "No changes" are computed, so
 * only open, merged and closed are stored.
 */
export type PullRequestStatus = 'open' | 'merged' | 'closed';

export const PULL_REQUEST_STATUSES: readonly PullRequestStatus[] = ['open', 'merged', 'closed'];

/** Withdrawn by its author, or rejected by a maintainer. */
export type PullRequestCloseKind = 'withdrawn' | 'rejected';

/** A full copy of the version of P the proposal was made against. */
export interface PullRequestBase {
  versionId: string;
  version: string;
  yaml: string;
}

/** The proposed pricing, always stored in the latest Pricing2Yaml syntax. */
export interface PullRequestProposal {
  yaml: string;
  suggestedVersion: string;
}

/**
 * Where a proposal made from a fork (F) of P comes from. `baseVersionId` is the
 * version of F the three-way merge used as its base and is never returned to
 * callers; `edited` turns true once the author changed the proposal by hand.
 */
export interface PullRequestOrigin {
  pricingId: string;
  versionId: string;
  version: string;
  baseVersionId: string;
  edited: boolean;
}

/**
 * The reservation a merge takes before publishing, so the proposal cannot
 * change or be closed meanwhile. It lapses at `until` (internal, never returned).
 */
export interface PullRequestMergeLock {
  id: string;
  byId: string;
  until: Date;
  revision: number;
}

export interface PullRequestMerged {
  byId: string;
  at: Date;
  versionId: string;
  version: string;
  proposalRevision: number;
}

export interface PullRequestClosed {
  byId: string;
  at: Date;
  kind: PullRequestCloseKind;
  reason?: string;
}

export interface PricingPullRequest {
  id: string;
  pricingId: string;
  /** Sequential within the pricing, from 1. */
  number: number;
  title: string;
  description: string;
  authorId: string;
  status: PullRequestStatus;
  base: PullRequestBase;
  proposed: PullRequestProposal;
  /** Moves on only when `proposed.yaml` changes. */
  proposalRevision: number;
  origin?: PullRequestOrigin;
  mergeLock?: PullRequestMergeLock;
  merged?: PullRequestMerged;
  closed?: PullRequestClosed;
  lastNotifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** What creating a pull request takes; the number, status and revision are set by the repository. */
export interface NewPricingPullRequest {
  pricingId: string;
  title: string;
  description: string;
  authorId: string;
  base: PullRequestBase;
  proposed: PullRequestProposal;
  origin?: PullRequestOrigin;
}

/**
 * The changes an open pull request accepts. A new `proposed` moves
 * `proposalRevision` on; `originEdited` is only meant for pull requests made
 * from a fork, which have an `origin`.
 */
export interface PullRequestChanges {
  title?: string;
  description?: string;
  base?: PullRequestBase;
  proposed?: PullRequestProposal;
  origin?: PullRequestOrigin;
  originEdited?: boolean;
}

export interface PullRequestListFilter {
  pricingId: string;
  /** Only the pull requests of this author (callers who are not maintainers). */
  authorId?: string;
  status?: PullRequestStatus;
}

export interface PullRequestPage {
  items: PricingPullRequest[];
  /** How many match the filter, status included. */
  total: number;
  /** How many there are of each status, with the same pricing and author but any status. */
  counts: Record<PullRequestStatus, number>;
}

/**
 * Where a pull request stands for whoever looks at it, computed on every read:
 * a maintainer compares it with the latest version of the pricing, anyone else
 * with the latest public one. `behind` carries how many conflicts merging it
 * would have (0: it can merge).
 */
export type PullRequestState =
  | { kind: 'merged' | 'closed' | 'no-public-version' | 'up-to-date' | 'no-changes' }
  | { kind: 'behind'; conflicts: number };

/** Why a caller cannot open a pull request now. Who is not a maintainer only ever gets `LIMIT_REACHED`. */
export type ProposalBlock = 'NO_PUBLIC_VERSION' | 'LIMIT_REACHED' | 'AUTHOR_LIMIT' | 'PRICING_LIMIT' | 'DAILY_LIMIT';

export interface PullRequestVersionRef {
  id: string;
  version: string;
}

/** The fork a proposal came from, only for who may read it (`show()`'s rules). */
export interface PullRequestOriginDTO {
  pricingId: string;
  name: string;
  slug: string;
  organization: { id: string; name: string; displayName: string };
  /** Only when the caller may also read that version of the fork. */
  versionId?: string;
  version?: string;
  /** The author changed the proposal by hand after it was made from the fork. */
  editedAfterProposal: boolean;
}

/** What a caller may do with a pull request now. */
export interface PullRequestPermissions {
  edit: boolean;
  editProposal: boolean;
  update: boolean;
  close: boolean;
  merge: boolean;
}

export interface PullRequestSummaryDTO {
  id: string;
  pricingId: string;
  number: number;
  title: string;
  status: PullRequestStatus;
  /** Null once the author's account is gone. */
  author: { id: string; username: string } | null;
  base: { versionId: string; version: string };
  proposed: { suggestedVersion: string };
  proposalRevision: number;
  state: PullRequestState;
  /** The merged version only for who may read it. */
  merged?: { at: Date; versionId?: string; version?: string };
  closed?: { kind: PullRequestCloseKind; at: Date; reason?: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface PullRequestDetailDTO extends Omit<PullRequestSummaryDTO, 'base' | 'proposed'> {
  description: string;
  base: { versionId: string; version: string; yaml: string };
  proposed: { suggestedVersion: string; yaml: string };
  origin?: PullRequestOriginDTO;
  permissions: PullRequestPermissions;
}

export interface PullRequestListDTO {
  items: PullRequestSummaryDTO[];
  total: number;
  counts: Record<PullRequestStatus, number>;
  proposals: { canOpen: boolean; reason: ProposalBlock | null; latest: PullRequestVersionRef | null };
  viewer: { isMaintainer: boolean };
}

/** Notices about what SPHERE did to a proposal when it stored it. */
export type PullRequestWarning = { code: 'SYNTAX_UPGRADED' } | { code: 'FORMAT_REGENERATED' };

export type PullRequestErrorCode =
  | 'WEB_SESSION_REQUIRED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'LIMIT_REACHED'
  | 'NO_PUBLIC_VERSION'
  | 'BASE_NOT_LATEST'
  | 'NO_CHANGES'
  | 'INVALID_PRICING'
  | 'PULL_REQUEST_NOT_OPEN'
  | 'PULL_REQUEST_MERGING'
  | 'PULL_REQUEST_BEHIND'
  | 'PULL_REQUEST_CHANGED';

/**
 * A refusal of the pull request routes, answered as `{ error, code, ...details }`.
 * Typed so its status never depends on words of the message (`handleError`
 * would answer 401 to a feature named "Unauthorized").
 */
export class PullRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: PullRequestErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'PullRequestError';
  }
}
