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
