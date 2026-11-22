/**
 * What the pull request routes (`/pricing-pull-requests`) answer, as the API
 * sends it (`api/src/main/types/models/PricingPullRequest.ts`). Dates arrive as
 * ISO strings.
 */

export type PullRequestStatus = 'open' | 'merged' | 'closed';

/** Withdrawn by its author, or rejected by a maintainer. */
export type PullRequestCloseKind = 'withdrawn' | 'rejected';

/**
 * Where a pull request stands for whoever looks at it: a maintainer compares it
 * with the latest version of the pricing, anyone else with the latest public
 * one. `behind` carries how many conflicts merging it would have (0: it can merge).
 */
export type PullRequestState =
  | { kind: 'merged' | 'closed' | 'no-public-version' | 'up-to-date' | 'no-changes' }
  | { kind: 'behind'; conflicts: number };

/** Why a caller cannot open a pull request now. Who is not a maintainer only ever gets `LIMIT_REACHED`. */
export type ProposalBlock = 'NO_PUBLIC_VERSION' | 'LIMIT_REACHED' | 'AUTHOR_LIMIT' | 'PRICING_LIMIT' | 'DAILY_LIMIT';

/** Why a fork cannot propose to the pricing it was forked from now. */
export type ForkProposalBlock =
  | 'NOT_A_FORK'
  | 'PARENT_UNAVAILABLE'
  | 'NO_PUBLIC_VERSION'
  | 'PULL_REQUEST_EXISTS'
  /** Merging the fork's latest version into the parent's latest public one would add nothing. */
  | 'NO_CHANGES';

export interface PullRequestVersionRef {
  id: string;
  version: string;
}

/** The fork a proposal came from, only for who may read it. */
export interface PullRequestOrigin {
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

/** What the caller may do with a pull request now. */
export interface PullRequestPermissions {
  edit: boolean;
  editProposal: boolean;
  update: boolean;
  close: boolean;
  merge: boolean;
}

export interface PullRequestSummary {
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
  /**
   * The merged version only for who may read it, and the version it was merged
   * on (`followed`) only for who may read that one too.
   */
  merged?: {
    at: string;
    versionId?: string;
    version?: string;
    /**
     * Details only. When the merged version and the one it was merged on are
     * written in different syntaxes, both come as the server compares them:
     * `normalizedYaml` here and on `followed`.
     */
    normalizedYaml?: string;
    followed?: { versionId: string; version: string; normalizedYaml?: string };
  };
  closed?: { kind: PullRequestCloseKind; at: string; reason?: string };
  createdAt: string;
  updatedAt: string;
}

export interface PullRequestDetail extends Omit<PullRequestSummary, 'base' | 'proposed'> {
  description: string;
  /**
   * Each as it is written. When the base and the proposal are in different
   * syntaxes, both also come as the server compares them (`normalizedYaml`: in
   * the latest syntax, without the values it reads as absent).
   */
  base: { versionId: string; version: string; yaml: string; normalizedYaml?: string };
  proposed: { suggestedVersion: string; yaml: string; normalizedYaml?: string };
  origin?: PullRequestOrigin;
  permissions: PullRequestPermissions;
}

export interface PullRequestList {
  items: PullRequestSummary[];
  total: number;
  counts: Record<PullRequestStatus, number>;
  proposals: { canOpen: boolean; reason: ProposalBlock | null; latest: PullRequestVersionRef | null };
  viewer: { isMaintainer: boolean };
}

/**
 * Notices about what SPHERE did to a proposal or a merge result: an input in an
 * older syntax, a result written again without its comments and layout, a
 * result typed by hand, a current version that changed what prices mean, and
 * an earlier proposal of the same fork that was merged.
 */
export type PullRequestWarning =
  | { code: 'SYNTAX_UPGRADED' }
  | { code: 'FORMAT_REGENERATED' }
  | { code: 'MANUAL_OVERRIDE' }
  | { code: 'GLOBAL_FIELD_CHANGED'; fields: string[] }
  | { code: 'PREVIOUSLY_MERGED'; number: number };

/** A pull request answered by a write, with what SPHERE did to the proposal. */
export type PullRequestWithWarnings = PullRequestDetail & { warnings: PullRequestWarning[] };

/** The pricing a fork proposes to. */
export interface ForkParent {
  pricingId: string;
  name: string;
  slug: string;
  organizationId: string;
}

/** A version of a fork that can be proposed to its parent. */
export interface ForkVersionOption {
  id: string;
  version: string;
  private: boolean;
  /** When SPHERE received it; null for versions older than that field. */
  addedAt: string | null;
}

/**
 * Whether the caller may propose a version of the fork to its parent. The open
 * pull request from the fork is named in full only to its author. `versions`
 * are the ones it may propose, newest first (the first by default): those added
 * after the version the parent last took in.
 */
export interface ForkTarget {
  canPropose: boolean;
  reason?: ForkProposalBlock;
  parent?: ForkParent;
  openPullRequest?: { id?: string; number: number; proposalRevision?: number };
  versions?: ForkVersionOption[];
}

/** A side of a conflict: absent, or its value written as YAML (so absent and `null` differ). */
export type ConflictSide = { present: false } | { present: true; yaml: string };

export type ConflictScope = 'value' | 'entry' | 'list' | 'order';

export type ConflictChoice = 'current' | 'proposal';

export type MergeSection = 'plans' | 'features' | 'addOns' | 'usageLimits' | 'general';

export interface MergeConflict {
  /** `JSON.stringify(path)`. */
  id: string;
  /** Keys from the top of the document; an `order` conflict names only its section. */
  path: string[];
  label: string;
  section: MergeSection;
  entry?: string;
  scope: ConflictScope;
  base: ConflictSide;
  current: ConflictSide;
  proposal: ConflictSide;
}

export type MergeOutcome = 'no-changes' | 'proposal-only' | 'merged' | 'conflicts';

/** Whether the result the server computed passes the pricing parser. */
export interface PreviewValidation {
  ok: boolean;
  error?: string;
  line?: number;
}

/**
 * A three-way merge computed without side effects. `previewToken` signs what it
 * was computed from and goes back with the submission.
 */
export interface PullRequestPreview {
  base: PullRequestVersionRef;
  target: PullRequestVersionRef & { private?: boolean };
  outcome: MergeOutcome;
  conflicts: MergeConflict[];
  /** In the syntax of the side it is whole; a combination of both sides is in the latest syntax. */
  resultYaml: string;
  /** When the result and the target are written in different syntaxes: both as the server compares them. */
  targetNormalizedYaml?: string;
  resultNormalizedYaml?: string;
  regenerated: boolean;
  validation: PreviewValidation;
  warnings: PullRequestWarning[];
  previewToken: string;
  suggestedVersion: string;
  /** The caller's own open pull request from the fork, which submitting replaces. */
  existingPullRequest?: { id: string; number: number; proposalRevision: number };
  /** Merge previews only: the suggested label is already a version of the pricing. */
  versionTaken?: boolean;
  /**
   * Merge previews only, when the suggested label is not the proposal's own: the
   * proposal's label reads as older than the latest public version's, which the suggestion follows.
   */
  suggestedVersionFollows?: { proposal: string; latest: string };
  defaults?: { private: boolean };
}

/** A proposal written on a version of the pricing, or a version of a fork (its newest proposable one by default). */
export type PullRequestSource =
  | { kind: 'text'; pricingId: string; baseVersionId: string; proposedYaml: string }
  | { kind: 'fork'; forkPricingId: string; versionId?: string };

/** The side chosen for each conflict, by conflict id. */
export type ConflictResolutions = Record<string, ConflictChoice>;

export interface NewTextPullRequest {
  title: string;
  description?: string;
  source: Extract<PullRequestSource, { kind: 'text' }>;
}

/** Proposing a fork's latest version as its preview showed it. */
export interface NewForkPullRequest {
  title: string;
  description?: string;
  source: Extract<PullRequestSource, { kind: 'fork' }>;
  resolutions: ConflictResolutions;
  /** The proposal typed by hand in the dialog's YAML view, which replaces the computed merge. */
  manualYaml?: string;
  previewToken: string;
}

/** The author's open pull request from the fork took the new proposal (200) instead of a new one (201). */
export type CreatedPullRequest = PullRequestWithWarnings & { updated?: true };

/** Bringing a pull request up to the latest public version, as its preview showed. */
export interface PullRequestUpdate {
  resolutions: ConflictResolutions;
  previewToken: string;
}

export type MergePreviewPurpose = 'update' | 'merge';

/** Merging as the merge preview showed it: the label and visibility of the new version and the choices made. */
export interface PullRequestMergeRequest {
  version: string;
  private: boolean;
  resolutions: ConflictResolutions;
  previewToken: string;
}

/** A merged pull request, the version it published and, for who may read private versions, the pricing's new ETag. */
export interface PullRequestMergeResult {
  pullRequest: PullRequestDetail;
  version: { id: string; version: string; private: boolean };
  etag?: string;
}

export type PullRequestErrorCode =
  | 'WEB_SESSION_REQUIRED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'LIMIT_REACHED'
  | 'NO_PUBLIC_VERSION'
  | 'BASE_NOT_LATEST'
  | 'NO_CHANGES'
  | 'INVALID_PRICING'
  | 'PRICING_TOO_LARGE'
  | 'PRICING_TOO_COMPLEX'
  | 'PRICING_SYNTAX_UNSUPPORTED'
  | 'PULL_REQUEST_NOT_OPEN'
  | 'PULL_REQUEST_MERGING'
  | 'PULL_REQUEST_BEHIND'
  | 'PULL_REQUEST_CHANGED'
  | 'PULL_REQUEST_UP_TO_DATE'
  | 'PULL_REQUEST_EXISTS'
  | 'PREVIEW_STALE'
  | 'NOT_A_FORK'
  | 'PARENT_UNAVAILABLE'
  | 'VERSION_NOT_PROPOSABLE'
  | 'UNRESOLVED_CONFLICTS'
  | 'UNKNOWN_RESOLUTION'
  | 'VERSION_TAKEN'
  | 'PRICING_CHANGED_DURING_MERGE'
  | 'PRECONDITION_FAILED'
  | 'MERGE_FAILED';
