import { createHash, timingSafeEqual } from 'crypto';
import fs from 'fs/promises';
import { retrievePricingFromText } from 'pricing4ts/server';
import container from '../config/container';
import { PermissionEngine } from '../policies/PermissionEngine';
import PricingCollectionRepository from '../repositories/mongoose/PricingCollectionRepository';
import PricingPullRequestRepository, { duplicateKeyFields } from '../repositories/mongoose/PricingPullRequestRepository';
import PricingRepository, { PricingIdentityRef, StoredVersion } from '../repositories/mongoose/PricingRepository';
import UserRepository from '../repositories/mongoose/UserRepository';
import {
  ForkTargetDTO,
  PreviewValidation,
  PricingPullRequest,
  ProposalBlock,
  PullRequestBase,
  PullRequestChanges,
  PullRequestDetailDTO,
  PullRequestError,
  PullRequestListDTO,
  PullRequestMergeDTO,
  PullRequestOriginDTO,
  PullRequestPermissions,
  PullRequestPreviewDTO,
  PullRequestState,
  PullRequestStatus,
  PullRequestSummaryDTO,
  PullRequestWarning,
} from '../types/models/PricingPullRequest';
import { LeanUser } from '../types/models/User';
import { formatPricingEtag, PreconditionFailedError, PricingPrecondition, PricingRevisionContext } from '../utils/pricing-etag';
import { requirePricingFile, writeUploadedPricingFile } from '../utils/pricing-files';
import { applyResolutions, MergeOutcome, MergeOutput, mergePricingDocs } from '../utils/pricing-merge';
import { withPricingRevisionLock } from '../utils/pricing-revision-lock';
import {
  dumpPricingDoc,
  normalizeProposalText,
  PricingDoc,
  PricingYamlError,
  PROPOSAL_DEFAULT_MAX_BYTES,
  PROPOSAL_MAX_BYTES_CEILING,
  STORED_PRICING_MAX_BYTES,
} from '../utils/pricing-syntax';
import { ParsedPricing, stampTopLevel } from '../utils/pricing-top-level';
import { serverHmac } from '../utils/users/helpers';
import PermissionService from './PermissionService';
import PricingPullRequestNotifier, { RoundKind } from './PricingPullRequestNotifier';
import PricingService from './PricingService';

const PAGE_SIZE = 20;
/** States computed for the listings, by pull request, proposal, base and target. */
const STATE_CACHE_ENTRIES = 500;
/**
 * Bases in an older syntax as the details show them (upgraded), by pull request,
 * proposal and base: at most this many, holding at most this many characters.
 */
const NORMALIZED_BASE_CACHE_ENTRIES = 500;
const NORMALIZED_BASE_CACHE_CHARACTERS = 32 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

const limitFromEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  const value = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(value) && value > 0 ? value : fallback;
};

/** Read on every request, so a change of the environment applies without a restart. */
const limits = () => ({
  openPerAuthor: limitFromEnv('PRICING_PR_MAX_OPEN_PER_AUTHOR', 5),
  openPerPricing: limitFromEnv('PRICING_PR_MAX_OPEN_PER_PRICING', 50),
  createdPerDay: limitFromEnv('PRICING_PR_MAX_CREATED_PER_DAY', 20),
  proposalBytes: Math.min(limitFromEnv('PRICING_PR_MAX_YAML_BYTES', PROPOSAL_DEFAULT_MAX_BYTES), PROPOSAL_MAX_BYTES_CEILING),
});

/** The pricing a pull request targets (P), with its latest versions. */
interface TargetPricing extends PricingIdentityRef {
  collectionSlug?: string;
  /** The latest version, private or not. */
  latest: StoredVersion;
  latestPublic: StoredVersion | null;
}

/** How the caller stands towards P. */
interface Viewer {
  user: LeanUser;
  /** P has a public version, or the caller may read its private ones. */
  reader: boolean;
  readsPrivate: boolean;
  /** May publish versions of P (CREATE) and read all of them. */
  maintainer: boolean;
}

interface LoadedPullRequest {
  pullRequest: PricingPullRequest;
  pricing: TargetPricing;
  viewer: Viewer;
}

interface MergeSummary {
  outcome: MergeOutcome;
  conflicts: number;
}

export interface TextSource {
  kind: 'text';
  pricingId: string;
  baseVersionId: string;
  proposedYaml: string;
}

export interface ForkSource {
  kind: 'fork';
  forkPricingId: string;
}

export interface NewPullRequestBody {
  title: string;
  description?: string;
  source: TextSource;
}

/** Proposing a fork's latest version: the choices made on its preview, or a result typed by hand. */
export interface ForkPullRequestBody {
  title: string;
  description?: string;
  source: ForkSource;
  resolutions?: Record<string, unknown>;
  manualYaml?: string;
  previewToken: string;
}

export interface PullRequestEdit {
  title?: string;
  description?: string;
  proposedYaml?: string;
}

/** Bringing a pull request up to the latest public version, as its preview showed. */
export interface PullRequestUpdate {
  resolutions?: Record<string, unknown>;
  manualYaml?: string;
  previewToken: string;
}

export type MergePreviewPurpose = 'update' | 'merge';

/** Merging as the merge preview showed it: the label and visibility of the new version, and the choices made. */
export interface PullRequestMergeBody {
  version: string;
  private: boolean;
  resolutions?: Record<string, unknown>;
  manualYaml?: string;
  previewToken: string;
}

/** A merge's answer, and the pricing's new ETag only for who may read its private versions. */
export interface MergeResult extends PullRequestMergeDTO {
  etag?: string;
}

/**
 * A pricing text in the latest syntax and its document. `regenerated` when it was
 * in an older one. `loaded` (the text as loaded, when it was kept as written) and
 * `parsed` (the parser's result, when it was parsed) spare stamping the text both.
 */
interface LoadedText {
  text: string;
  doc: PricingDoc;
  regenerated: boolean;
  loaded?: PricingDoc;
  parsed?: ParsedPricing;
}

/** A stored version's file as read from disk (`raw`), and in the latest syntax. */
interface StoredText extends LoadedText {
  raw: string;
}

/** The three sides of a merge: where the proposal started, what it is merged into, and the proposal. */
interface MergeInputs {
  base: LoadedText;
  current: LoadedText;
  proposal: LoadedText;
}

/** What a merge gives once the caller's choices (or their own text) are applied. */
interface ComputedResult {
  output: MergeOutput;
  outcome: MergeOutcome;
  text: string;
  regenerated: boolean;
  validation: PreviewValidation;
  suggestedVersion: string;
  warnings: PullRequestWarning[];
}

/**
 * What a preview token signs: who asked for it, about what (`subjectId`: P for a
 * text, the fork, or the pull request) and the inputs it was computed from.
 * Only ids the caller already received.
 */
interface PreviewPayload {
  purpose: 'text' | 'fork' | MergePreviewPurpose;
  subjectId: string;
  viewerId: string;
  baseRef: string;
  targetVersionId: string;
  proposalRef: string;
}

type ForkVersion = StoredVersion & { forkedFromPricingId: string | null };

/** A fork the caller may propose from, the versions of it they may read (newest first) and its parent P. */
interface ForkContext {
  fork: PricingIdentityRef;
  versions: ForkVersion[];
  pricing: TargetPricing;
  viewer: Viewer;
}

const PREVIEW_TOKEN_PURPOSE = 'pricing-pr-preview';

/** A small least-recently-used map, bounded by its entries and by the total size of its values. */
class LruCache<V> {
  private entries = new Map<string, V>();
  private size = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly sizeOf: (value: V) => number = () => 0,
    private readonly maxSize = Infinity
  ) {}

  get(key: string): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key)!;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V) {
    if (this.entries.has(key)) this.remove(key);
    this.entries.set(key, value);
    this.size += this.sizeOf(value);
    while (this.entries.size > this.maxEntries || this.size > this.maxSize) this.remove(this.entries.keys().next().value!);
  }

  private remove(key: string) {
    this.size -= this.sizeOf(this.entries.get(key)!);
    this.entries.delete(key);
  }
}

const notFound = (what = 'Pull request') => new PullRequestError(404, 'NOT_FOUND', `${what} not found`);

const lockIsLive = (pullRequest: PricingPullRequest, now = new Date()) =>
  Boolean(pullRequest.mergeLock && pullRequest.mergeLock.until.getTime() > now.getTime());

/** Calls `load` once, the first time the value is needed. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => (value ??= load());
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** `base64url(JSON payload).base64url(MAC)`: the client can read it, only the server can make it. */
function signPreview(payload: PreviewPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${serverHmac(PREVIEW_TOKEN_PURPOSE, body).toString('base64url')}`;
}

/** The payload of a token this server signed, or null for anything else. */
function readPreview(token: unknown): PreviewPayload | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = serverHmac(PREVIEW_TOKEN_PURPOSE, body);
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PreviewPayload;
  } catch {
    return null;
  }
}

const previewStale = () =>
  new PullRequestError(409, 'PREVIEW_STALE', 'What you reviewed changed meanwhile; look at the preview again');

const notOpen = () => new PullRequestError(409, 'PULL_REQUEST_NOT_OPEN', 'The pull request is no longer open');

const changedDuringMerge = () =>
  new PullRequestError(409, 'PRICING_CHANGED_DURING_MERGE', 'The pricing changed while merging; look at the merge again');

/**
 * What a failed publish of a merge is answered: a pricing that changed after the
 * merge was checked, a label taken meanwhile, or permissions lost. Told apart by
 * the start of the message only: a feature named "Unauthorized" must not turn
 * into a 401 (`handleError` looks for words anywhere).
 */
function publishRefusal(error: unknown): PullRequestError {
  if (error instanceof PreconditionFailedError) return changedDuringMerge();
  const message = String((error as Error)?.message ?? error);
  if (message.startsWith('CONFLICT:')) return new PullRequestError(409, 'VERSION_TAKEN', message.slice('CONFLICT:'.length).trim());
  if (message.startsWith('PERMISSION ERROR')) {
    return new PullRequestError(403, 'FORBIDDEN', 'You may no longer publish versions of this pricing');
  }
  console.error('[Pricing pull request] Could not publish a merge:', error);
  return new PullRequestError(500, 'MERGE_FAILED', 'The merged version could not be published');
}

const versionRef = (version: StoredVersion) => ({ id: version.id, version: version.version });

const baseNotLatest = (latest: StoredVersion) =>
  new PullRequestError(409, 'BASE_NOT_LATEST', 'There is a newer public version than the one you reviewed', {
    latest: versionRef(latest),
  });

/** The parser's verdict on a result, with the line of a YAML error. */
function validate(text: string): { validation: PreviewValidation; version?: string; parsed?: ParsedPricing } {
  try {
    const parsed = retrievePricingFromText(text);
    return { validation: { ok: true }, version: String(parsed.version), parsed };
  } catch (error) {
    const line = (error as { mark?: { line?: number } })?.mark?.line;
    return {
      validation: {
        ok: false,
        error: (error as Error)?.message ?? String(error),
        ...(typeof line === 'number' ? { line: line + 1 } : {}),
      },
    };
  }
}

/**
 * Pull requests propose a new version of a pricing (P) on top of its latest
 * public version, without publishing anything. Every permission is checked
 * here: the routes live outside /pricings/**, so the middleware checks neither
 * membership nor entity permissions. Only web sessions reach this service.
 *
 * A pull request is shown to its author while they may still read P, and to the
 * maintainers of P: who may publish versions of it (CREATE) and read all of
 * them. Anyone else is told it does not exist. Nothing in an answer to who may
 * not read the private versions of P names, counts or quotes one of them.
 */
class PricingPullRequestService {
  private pricingPullRequestRepository: PricingPullRequestRepository;
  private pricingRepository: PricingRepository;
  private pricingCollectionRepository: PricingCollectionRepository;
  private userRepository: UserRepository;
  private permissionService: PermissionService;
  private pricingService: PricingService;
  private notifier: PricingPullRequestNotifier;
  private permissionEngine = new PermissionEngine();
  private states = new LruCache<MergeSummary>(STATE_CACHE_ENTRIES);
  private normalizedBases = new LruCache<{ normalizedYaml?: string }>(
    NORMALIZED_BASE_CACHE_ENTRIES,
    value => value.normalizedYaml?.length ?? 0,
    NORMALIZED_BASE_CACHE_CHARACTERS
  );

  constructor() {
    this.pricingPullRequestRepository = container.resolve('pricingPullRequestRepository');
    this.pricingRepository = container.resolve('pricingRepository');
    this.pricingCollectionRepository = container.resolve('pricingCollectionRepository');
    this.userRepository = container.resolve('userRepository');
    this.permissionService = container.resolve('permissionService');
    this.pricingService = container.resolve('pricingService');
    this.notifier = container.resolve('pricingPullRequestNotifier');
  }

  /**
   * A page of the pull requests of P: all of them for a maintainer, only the
   * caller's own for anyone else, with whether the caller may open one now.
   */
  async list(
    user: LeanUser,
    query: { pricingId: string; status?: PullRequestStatus; page?: number }
  ): Promise<PullRequestListDTO> {
    const pricing = await this.findPricing(query.pricingId);
    const viewer = pricing && (await this.viewerOf(user, pricing));
    if (!pricing || !viewer?.reader) throw notFound('Pricing');

    const page = await this.pricingPullRequestRepository.list(
      { pricingId: pricing.pricingId, authorId: viewer.maintainer ? undefined : user.id, status: query.status },
      query.page ?? 1,
      PAGE_SIZE
    );
    const targetDoc = this.targetDocOf(pricing, viewer);
    const authors = await this.authorsOf(page.items);
    const items: PullRequestSummaryDTO[] = [];
    for (const pullRequest of page.items) {
      items.push(await this.summaryOf(pullRequest, pricing, viewer, authors, targetDoc));
    }

    const block = await this.proposalBlock(user, pricing);
    return {
      items,
      total: page.total,
      counts: page.counts,
      proposals: {
        canOpen: block === null,
        reason: block === null ? null : viewer.maintainer || block === 'NO_PUBLIC_VERSION' ? block : 'LIMIT_REACHED',
        latest: pricing.latestPublic ? { id: pricing.latestPublic.id, version: pricing.latestPublic.version } : null,
      },
      viewer: { isMaintainer: viewer.maintainer },
    };
  }

  /**
   * Opens a pull request on P with a proposal written by hand (the editor or an
   * uploaded file). It must start from the latest public version of P and
   * change something; it is stored in the latest syntax with P's name.
   */
  async create(user: LeanUser, body: NewPullRequestBody): Promise<PullRequestDetailDTO & { warnings: PullRequestWarning[] }> {
    const { source } = body;
    const pricing = await this.findPricing(source.pricingId);
    const viewer = pricing && (await this.viewerOf(user, pricing));
    if (!pricing || !viewer?.reader) throw notFound('Pricing');
    const base = await this.pricingRepository.findVersionOf(pricing.pricingId, source.baseVersionId);
    if (!base || (base.private && !viewer.readsPrivate)) throw notFound('Version');

    // Counted before anything is parsed, so a caller past the limits costs no CPU.
    if (await this.limitReached(user, pricing.pricingId)) {
      throw new PullRequestError(429, 'LIMIT_REACHED', 'You cannot open more pull requests for now');
    }
    const latestPublic = this.requireLatestPublic(pricing);
    if (base.id !== latestPublic.id) {
      throw new PullRequestError(409, 'BASE_NOT_LATEST', 'Pull requests start from the latest public version', {
        latest: { id: latestPublic.id, version: latestPublic.version },
      });
    }

    const proposal = this.prepareProposal(source.proposedYaml, pricing);
    const baseText = await this.readStored(latestPublic);
    const outcome = mergePricingDocs(baseText.doc, baseText.doc, proposal.doc).outcome;
    if (outcome === 'no-changes') {
      throw new PullRequestError(400, 'NO_CHANGES', 'The proposal does not change the latest public version');
    }

    const created = await this.pricingPullRequestRepository.create({
      pricingId: pricing.pricingId,
      title: body.title,
      description: body.description ?? '',
      // Always the caller: no field of the request names the author.
      authorId: user.id,
      base: { versionId: latestPublic.id, version: latestPublic.version, yaml: baseText.raw },
      proposed: { yaml: proposal.text, suggestedVersion: proposal.suggestedVersion },
    });
    await this.announce('opened', created, pricing, user);
    return { ...(await this.detailOf({ pullRequest: created, pricing, viewer })), warnings: proposal.warnings };
  }

  async show(user: LeanUser, id: string): Promise<PullRequestDetailDTO> {
    return this.detailOf(await this.loadPullRequest(user, id));
  }

  /**
   * The author changes the title, the description or the proposal of their open
   * pull request. The proposal only while the pull request starts from the
   * latest public version: otherwise it has to be brought up to date first.
   */
  async edit(user: LeanUser, id: string, changes: PullRequestEdit): Promise<PullRequestDetailDTO & { warnings: PullRequestWarning[] }> {
    const loaded = await this.loadPullRequest(user, id);
    const { pullRequest, pricing } = loaded;
    if (pullRequest.authorId !== user.id) {
      throw new PullRequestError(403, 'FORBIDDEN', 'Only the author can edit a pull request');
    }
    this.assertOpen(pullRequest);

    const update: PullRequestChanges = {};
    if (changes.title !== undefined) update.title = changes.title;
    if (changes.description !== undefined) update.description = changes.description;
    let warnings: PullRequestWarning[] = [];
    if (changes.proposedYaml !== undefined) {
      const latestPublic = this.requireLatestPublic(pricing);
      if (pullRequest.base.versionId !== latestPublic.id) {
        throw new PullRequestError(409, 'PULL_REQUEST_BEHIND', 'Update the pull request to the latest public version before changing its proposal');
      }
      const proposal = this.prepareProposal(changes.proposedYaml, pricing);
      const base = this.storedDoc(pullRequest.base.yaml);
      if (mergePricingDocs(base, base, proposal.doc).outcome === 'no-changes') {
        throw new PullRequestError(400, 'NO_CHANGES', 'The proposal does not change the latest public version');
      }
      update.proposed ={ yaml: proposal.text, suggestedVersion: proposal.suggestedVersion };
      // The proposal is no longer what the fork had.
      if (pullRequest.origin) update.originEdited = true;
      warnings = proposal.warnings;
    }
    if (Object.keys(update).length === 0) return { ...(await this.detailOf(loaded)), warnings };

    const updated = await this.pricingPullRequestRepository.updateOpen(id, pullRequest.proposalRevision, update);
    if (!updated) throw await this.refusalOf(id);
    return { ...(await this.detailOf({ ...loaded, pullRequest: updated })), warnings };
  }

  /** The author withdraws their pull request, or a maintainer rejects it. */
  async close(user: LeanUser, id: string, reason?: string): Promise<PullRequestDetailDTO> {
    const loaded = await this.loadPullRequest(user, id);
    const { pullRequest } = loaded;
    this.assertOpen(pullRequest);
    const kind = pullRequest.authorId === user.id ? 'withdrawn' : 'rejected';
    const closed = await this.pricingPullRequestRepository.close(id, {
      byId: user.id,
      at: new Date(),
      kind,
      ...(reason ? { reason } : {}),
    });
    if (!closed) throw await this.refusalOf(id);
    if (kind === 'rejected') this.inBackground(this.notifier.notifyClosed(closed, loaded.pricing, user));
    return this.detailOf({ ...loaded, pullRequest: closed });
  }

  /**
   * Whether the caller may propose the latest version of the fork F they may read
   * to the pricing it was forked from, and why not. Computed only on the versions
   * of F the caller may read: who may not read F is told it does not exist, and
   * who may read it but not publish versions of it is refused.
   */
  async forkTarget(user: LeanUser, forkPricingId: string): Promise<ForkTargetDTO> {
    const context = await this.forkContext(user, forkPricingId);
    if (typeof context === 'string') return { canPropose: false, reason: context };
    const { pricing } = context;
    const parent = { pricingId: pricing.pricingId, name: pricing.name, slug: pricing.slug, organizationId: pricing.organizationId };
    if (!pricing.latestPublic) return { canPropose: false, reason: 'NO_PUBLIC_VERSION', parent };
    const open = await this.pricingPullRequestRepository.findOpenFromFork(pricing.pricingId, context.fork.pricingId);
    if (open && open.authorId !== user.id) {
      return { canPropose: false, reason: 'PULL_REQUEST_EXISTS', parent, openPullRequest: { number: open.number } };
    }
    return {
      canPropose: true,
      parent,
      ...(open ? { openPullRequest: { id: open.id, number: open.number, proposalRevision: open.proposalRevision } } : {}),
    };
  }

  /**
   * The three-way merge a proposal would make, without writing anything: a text
   * against the latest public version of P from the version it was written on,
   * or the latest version of a fork from the version of it that P last contained.
   */
  async preview(
    user: LeanUser,
    body: { source: TextSource | ForkSource; resolutions?: Record<string, unknown> }
  ): Promise<PullRequestPreviewDTO> {
    const resolutions = body.resolutions ?? {};
    if (body.source.kind === 'fork') {
      const context = await this.requireForkContext(user, body.source.forkPricingId);
      return this.inForkQueue(context, async () => {
        const { pricing } = context;
        const latestPublic = this.requireLatestPublic(pricing);
        const open = await this.pricingPullRequestRepository.findOpenFromFork(pricing.pricingId, context.fork.pricingId);
        if (open && open.authorId !== user.id) throw this.pullRequestExists(open);
        const sides = await this.forkSides(context);
        const inputs = await this.inputsOf(sides.base, latestPublic, sides.proposal);
        const result = this.computeResult(pricing, inputs.inputs, resolutions, undefined, false);
        return {
          ...this.previewOf(result, versionRef(sides.base), versionRef(latestPublic), {
            purpose: 'fork',
            subjectId: context.fork.pricingId,
            viewerId: user.id,
            baseRef: sides.base.id,
            targetVersionId: latestPublic.id,
            proposalRef: `${sides.proposal.id}:${open ? open.proposalRevision : 'none'}`,
          }, sides.previouslyMerged),
          ...(open ? { existingPullRequest: { id: open.id, number: open.number, proposalRevision: open.proposalRevision } } : {}),
        };
      });
    }

    const { source } = body;
    const pricing = await this.findPricing(source.pricingId);
    const viewer = pricing && (await this.viewerOf(user, pricing));
    if (!pricing || !viewer?.reader) throw notFound('Pricing');
    const base = await this.pricingRepository.findVersionOf(pricing.pricingId, source.baseVersionId);
    if (!base || (base.private && !viewer.readsPrivate)) throw notFound('Version');
    const latestPublic = this.requireLatestPublic(pricing);
    const proposal = normalizeProposalText(source.proposedYaml, limits().proposalBytes);
    const baseText = await this.readStored(base);
    const current = base.id === latestPublic.id ? baseText : await this.readStored(latestPublic);
    const result = this.computeResult(pricing, { base: baseText, current, proposal }, resolutions, undefined, false);
    return this.previewOf(result, versionRef(base), versionRef(latestPublic), {
      purpose: 'text',
      subjectId: pricing.pricingId,
      viewerId: user.id,
      baseRef: base.id,
      targetVersionId: latestPublic.id,
      proposalRef: sha256(source.proposedYaml),
    });
  }

  /**
   * Proposes the latest version of a fork F (that the caller may read) to its
   * parent P, as its preview showed it, with the conflicts resolved or a result
   * typed by hand. At most one pull request from F to P is open: its author's
   * new proposal replaces the one it has (`created: false`), anyone else's is
   * refused. Requests for the same fork and parent run one after the other.
   */
  async proposeFromFork(
    user: LeanUser,
    body: ForkPullRequestBody
  ): Promise<{ created: boolean; pullRequest: PullRequestDetailDTO & { warnings: PullRequestWarning[] } }> {
    const context = await this.requireForkContext(user, body.source.forkPricingId);
    return this.inForkQueue(context, async () => {
      const { pricing, viewer, fork } = context;
      const open = await this.pricingPullRequestRepository.findOpenFromFork(pricing.pricingId, fork.pricingId);
      const own = open?.authorId === user.id ? open : null;
      // Replacing one's own proposal is not opening a new pull request.
      if (!own && (await this.limitReached(user, pricing.pricingId))) {
        throw new PullRequestError(429, 'LIMIT_REACHED', 'You cannot open more pull requests for now');
      }
      const latestPublic = this.requireLatestPublic(pricing);
      if (open && !own) throw this.pullRequestExists(open);

      const sides = await this.forkSides(context);
      const { inputs, currentRaw } = await this.inputsOf(sides.base, latestPublic, sides.proposal);
      const manual = body.manualYaml === undefined ? undefined : this.loadManual(body.manualYaml);
      const token = readPreview(body.previewToken);
      // An open pull request created from this same preview (by a request sent at the same time) is the one to replace.
      const createdMeanwhile = (candidate: PricingPullRequest | null) =>
        candidate !== null &&
        token?.proposalRef === `${sides.proposal.id}:none` &&
        candidate.proposalRevision === 1 &&
        candidate.origin?.versionId === sides.proposal.id &&
        !candidate.origin.edited;
      const proposalRef = (candidate: PricingPullRequest | null) =>
        `${sides.proposal.id}:${candidate && !createdMeanwhile(candidate) ? candidate.proposalRevision : 'none'}`;
      this.checkPreview(body.previewToken, {
        purpose: 'fork',
        subjectId: fork.pricingId,
        viewerId: user.id,
        baseRef: sides.base.id,
        targetVersionId: latestPublic.id,
        proposalRef: proposalRef(own),
      }, () => baseNotLatest(latestPublic));

      const result = this.computeResult(pricing, inputs, body.resolutions ?? {}, manual, true);
      this.requireValid(result);
      if (result.outcome === 'no-changes') {
        throw new PullRequestError(400, 'NO_CHANGES', 'The fork has nothing the latest public version does not already have');
      }

      const base: PullRequestBase = { versionId: latestPublic.id, version: latestPublic.version, yaml: currentRaw };
      const proposed = { yaml: result.text, suggestedVersion: result.suggestedVersion };
      const origin = {
        pricingId: fork.pricingId,
        versionId: sides.proposal.id,
        version: sides.proposal.version,
        baseVersionId: sides.base.id,
        edited: manual !== undefined,
      };
      const replace = async (target: PricingPullRequest) => {
        const updated = await this.pricingPullRequestRepository.updateOpen(target.id, target.proposalRevision, {
          title: body.title,
          ...(body.description !== undefined ? { description: body.description } : {}),
          base,
          proposed,
          origin,
        });
        if (!updated) throw await this.refusalOf(target.id, true);
        await this.announce('updated', updated, pricing, user);
        return updated;
      };
      const answer = async (created: boolean, pullRequest: PricingPullRequest) => ({
        created,
        pullRequest: { ...(await this.detailOf({ pullRequest, pricing, viewer })), warnings: result.warnings },
      });

      if (own) return answer(false, await replace(own));
      try {
        const created = await this.pricingPullRequestRepository.create({
          pricingId: pricing.pricingId,
          title: body.title,
          description: body.description ?? '',
          authorId: user.id,
          base,
          proposed,
          origin,
        });
        await this.announce('opened', created, pricing, user);
        return answer(true, created);
      } catch (error) {
        // Another request opened the pull request from F first (the unique index on open pull requests per fork).
        const fields = duplicateKeyFields(error);
        if (!fields || fields.join() !== 'pricingId,origin.pricingId') throw error;
        const winner = await this.pricingPullRequestRepository.findOpenFromFork(pricing.pricingId, fork.pricingId);
        if (!winner) throw previewStale();
        if (winner.authorId !== user.id) throw this.pullRequestExists(winner);
        if (!createdMeanwhile(winner)) throw previewStale();
        return answer(false, await replace(winner));
      }
    });
  }

  /**
   * The merge an open pull request would make with its target, without writing
   * anything: for its author bringing it up to the latest public version
   * (`update`), or for a maintainer merging it into the latest version (`merge`).
   */
  async mergePreview(
    user: LeanUser,
    id: string,
    body: { purpose: MergePreviewPurpose; resolutions?: Record<string, unknown> }
  ): Promise<PullRequestPreviewDTO> {
    const loaded = await this.loadPullRequest(user, id);
    const { pullRequest, pricing, viewer } = loaded;
    if (body.purpose === 'update' && pullRequest.authorId !== user.id) {
      throw new PullRequestError(403, 'FORBIDDEN', 'Only the author can update a pull request');
    }
    if (body.purpose === 'merge' && !viewer.maintainer) {
      throw new PullRequestError(403, 'FORBIDDEN', 'Only a maintainer of the pricing can merge a pull request');
    }
    this.assertOpen(pullRequest);
    const target = body.purpose === 'update' ? this.requireBehind(pullRequest, pricing) : pricing.latest;

    const current = await this.readStored(target);
    const inputs = { base: this.loadStored(pullRequest.base.yaml), current, proposal: this.loadStored(pullRequest.proposed.yaml) };
    const result = this.computeResult(pricing, inputs, body.resolutions ?? {}, undefined, false);
    const preview = this.previewOf(result, { id: pullRequest.base.versionId, version: pullRequest.base.version }, versionRef(target), {
      purpose: body.purpose,
      subjectId: pullRequest.id,
      viewerId: user.id,
      baseRef: pullRequest.base.versionId,
      targetVersionId: target.id,
      proposalRef: String(pullRequest.proposalRevision),
    });
    if (body.purpose === 'update') return preview;
    return {
      ...preview,
      target: { ...preview.target, private: target.private },
      versionTaken: await this.pricingRepository.hasVersionLabel(pricing.pricingId, preview.suggestedVersion),
      defaults: { private: target.private },
    };
  }

  /**
   * The author brings their pull request up to the latest public version, as
   * its update preview showed it: its base becomes that version and its
   * proposal the merge, with the conflicts resolved or a result typed by hand.
   * A merge that adds nothing leaves it with no changes.
   */
  async update(user: LeanUser, id: string, body: PullRequestUpdate): Promise<PullRequestDetailDTO & { warnings: PullRequestWarning[] }> {
    const loaded = await this.loadPullRequest(user, id);
    const { pullRequest, pricing } = loaded;
    if (pullRequest.authorId !== user.id) {
      throw new PullRequestError(403, 'FORBIDDEN', 'Only the author can update a pull request');
    }
    this.assertOpen(pullRequest);
    const target = this.requireBehind(pullRequest, pricing);

    const current = await this.readStored(target);
    const inputs = { base: this.loadStored(pullRequest.base.yaml), current, proposal: this.loadStored(pullRequest.proposed.yaml) };
    const manual = body.manualYaml === undefined ? undefined : this.loadManual(body.manualYaml);
    this.checkPreview(body.previewToken, {
      purpose: 'update',
      subjectId: pullRequest.id,
      viewerId: user.id,
      baseRef: pullRequest.base.versionId,
      targetVersionId: target.id,
      proposalRef: String(pullRequest.proposalRevision),
    }, () => baseNotLatest(target));
    const result = this.computeResult(pricing, inputs, body.resolutions ?? {}, manual, true);
    this.requireValid(result);

    const updated = await this.pricingPullRequestRepository.updateOpen(id, pullRequest.proposalRevision, {
      base: { versionId: target.id, version: target.version, yaml: current.raw },
      proposed: { yaml: result.text, suggestedVersion: result.suggestedVersion },
      // A result typed by hand is no longer what the fork had.
      ...(manual && pullRequest.origin ? { originEdited: true } : {}),
    });
    if (!updated) throw await this.refusalOf(id, true);
    return { ...(await this.detailOf({ ...loaded, pullRequest: updated })), warnings: result.warnings };
  }

  /**
   * A maintainer merges an open pull request into the latest version of P, as
   * its merge preview showed it: the result is published as a new version
   * through `PricingService.createVersion` (its permission, label, analytics,
   * followers and revision checks), stamped with the label, P's name and the
   * current instant, and recording the pull request it came from.
   *
   * The latest version and the pricing's revision are read together; the
   * publish claims that revision, so a version published meanwhile by anyone
   * makes this merge fail rather than merge into what was not reviewed. The pull
   * request is reserved first, at the proposal that was reviewed, so it cannot
   * change or close while it is merged, nor be merged twice.
   */
  async merge(user: LeanUser, id: string, body: PullRequestMergeBody, precondition?: PricingPrecondition): Promise<MergeResult> {
    const loaded = await this.loadPullRequest(user, id);
    const { pullRequest, pricing, viewer } = loaded;
    if (!viewer.maintainer) {
      throw new PullRequestError(403, 'FORBIDDEN', 'Only a maintainer of the pricing can merge a pull request');
    }
    if (pullRequest.status !== 'open') throw notOpen();

    // Read like a revision-bearing read: never between another write's claim and its content.
    const { revision, latest } = await withPricingRevisionLock(pricing.pricingId, async () => ({
      revision: await this.pricingRepository.findRevision(pricing.pricingId),
      latest: await this.pricingRepository.findLatestVersion(pricing.pricingId),
    }));
    if (revision === null || !latest) throw notFound();
    const proposalRevision = pullRequest.proposalRevision;
    this.checkPreview(body.previewToken, {
      purpose: 'merge',
      subjectId: pullRequest.id,
      viewerId: user.id,
      baseRef: pullRequest.base.versionId,
      targetVersionId: latest.id,
      proposalRef: String(proposalRevision),
    }, () => new PullRequestError(409, 'PREVIEW_STALE', 'There is a newer version than the one you reviewed'));
    if (precondition && !this.preconditionHolds(precondition, pricing.pricingId, revision, viewer)) {
      throw new PreconditionFailedError(viewer.readsPrivate ? formatPricingEtag(pricing.pricingId, revision) : undefined);
    }

    const current = await this.readStored(latest);
    const inputs = { base: this.loadStored(pullRequest.base.yaml), current, proposal: this.loadStored(pullRequest.proposed.yaml) };
    const manual = body.manualYaml === undefined ? undefined : this.loadManual(body.manualYaml);
    const result = this.computeResult(pricing, inputs, body.resolutions ?? {}, manual, true);
    this.requireValid(result);
    if (result.outcome === 'no-changes') {
      throw new PullRequestError(400, 'NO_CHANGES', 'Merging the pull request adds nothing to the latest version');
    }

    const label = body.version;
    if (await this.pricingRepository.hasVersionLabel(pricing.pricingId, label)) {
      throw new PullRequestError(409, 'VERSION_TAKEN', `Version ${label} of ${pricing.name} already exists`);
    }
    // createVersion finds the pricing to add the version to by slug: it must be P.
    const target = await this.pricingRepository.findOne(pricing.slug, pricing.organizationId, {
      includePrivate: true,
      collectionId: pricing.collectionId ?? undefined,
    });
    if (!target || String(target.pricingId) !== pricing.pricingId) throw changedDuringMerge();
    const now = new Date();
    const stamped = stampTopLevel(result.text, { version: label, saasName: pricing.name, createdAt: now });

    const lock = await this.pricingPullRequestRepository.reserveForMerge(id, proposalRevision, user.id, now);
    if (!lock) throw await this.refusalOf(id, true);
    const file = writeUploadedPricingFile(pricing.organizationId, pricing.slug, label, stamped.text, 'pr');
    // The revision read with the latest version, which the caller may read: they maintain P.
    const context: PricingRevisionContext = {
      precondition: { kind: 'tags', tags: [{ pricingId: String(pricing.pricingId), revision }] },
      mayRead: true,
    };
    let published;
    try {
      published = await this.pricingService.createVersion(
        { path: file },
        pricing.organizationId,
        pricing.slug,
        body.private,
        user,
        pricing.collectionId ?? undefined,
        now,
        context,
        { number: pullRequest.number, prId: pullRequest.id }
      );
    } catch (error) {
      // A failure once the version was stored leaves it published: its file stays,
      // and the reservation lets the next load mark the pull request merged.
      if (!(await this.pricingRepository.findMergedVersion(pricing.pricingId, id))) {
        await Promise.allSettled([this.pricingPullRequestRepository.releaseMerge(id, lock.id), fs.rm(file, { force: true })]);
      }
      throw publishRefusal(error);
    }

    // From here on the file belongs to the published version and is never removed.
    const version = { id: String(published[0]._id), version: label, private: body.private };
    const merged =
      (await this.pricingPullRequestRepository.markMerged(id, lock.id, {
        byId: user.id,
        at: now,
        versionId: version.id,
        version: label,
        proposalRevision,
      })) ??
      (await this.pricingPullRequestRepository.findById(id)) ??
      pullRequest;
    this.inBackground(this.notifier.notifyMerged(merged, pricing, user, version));
    return {
      pullRequest: await this.detailOf({ ...loaded, pullRequest: merged }),
      version,
      ...(viewer.readsPrivate && context.etag ? { etag: context.etag } : {}),
    };
  }

  /**
   * Whether an If-Match names P at `revision`. Who may not read P's private
   * versions never gets its tag, so no tag of theirs matches (only `*`).
   */
  private preconditionHolds(precondition: PricingPrecondition, pricingId: string, revision: number, viewer: Viewer) {
    if (precondition.kind === 'any') return true;
    return viewer.readsPrivate && precondition.tags.some(tag => tag.pricingId === pricingId && tag.revision === revision);
  }

  /**
   * A merge that published its version but stopped before marking the pull
   * request merged (the process went down, or marking it failed) still holds its
   * reservation: the version that records the pull request is the proof, and the
   * pull request is marked merged with it. Without one, the reservation lapses.
   */
  private async reconcileMerge(pullRequest: PricingPullRequest): Promise<PricingPullRequest> {
    const lock = pullRequest.mergeLock;
    if (!lock || pullRequest.status !== 'open') return pullRequest;
    const published = await this.pricingRepository.findMergedVersion(pullRequest.pricingId, pullRequest.id);
    if (!published) return pullRequest;
    const merged = await this.pricingPullRequestRepository.markMerged(pullRequest.id, lock.id, {
      byId: lock.byId,
      at: new Date(),
      versionId: published.id,
      version: published.version,
      proposalRevision: lock.revision,
    });
    return merged ?? (await this.pricingPullRequestRepository.findById(pullRequest.id)) ?? pullRequest;
  }

  /**
   * Tells the maintainers of P about a pull request that was opened, or whose
   * proposal its fork replaced (at most once a day). The round is claimed before
   * answering, so the requests that follow see it; it is delivered in the background.
   */
  private async announce(kind: RoundKind, pullRequest: PricingPullRequest, pricing: TargetPricing, author: LeanUser) {
    try {
      if (!(await this.notifier.claimRound(pullRequest.id, kind))) return;
      const isMaintainer = async (candidate: LeanUser) => (await this.viewerOf(candidate, pricing)).maintainer;
      this.inBackground(this.notifier.notifyMaintainers(kind, pullRequest, pricing, author, isMaintainer));
    } catch (error) {
      console.error('[Pricing pull request] Could not notify the maintainers:', error);
    }
  }

  /** Notifications never delay or fail the action that started them. */
  private inBackground(task: Promise<unknown>) {
    void task.catch(error => console.error('[Pricing pull request] Could not notify:', error));
  }

  /**
   * The fork F and its parent P as the caller sees them. Who may not read F gets
   * 404 and who may not publish versions of it 403; a fork none of whose readable
   * versions names where it came from is `NOT_A_FORK`, and a parent that is gone
   * or that the caller may not read is `PARENT_UNAVAILABLE` (the same answer).
   */
  private async forkContext(user: LeanUser, forkPricingId: string): Promise<ForkContext | 'NOT_A_FORK' | 'PARENT_UNAVAILABLE'> {
    const fork = await this.pricingRepository.findIdentity(forkPricingId);
    const readable = fork && (await this.readableVersionIds(user, fork));
    if (!fork || !readable) throw notFound('Pricing');
    if (!(await this.mayPublishVersions(user, fork))) {
      throw new PullRequestError(403, 'FORBIDDEN', 'Proposing from a fork takes being able to publish versions of it');
    }
    const versions = (await this.pricingRepository.findForkVersions(fork.pricingId)).filter(version => readable.has(version.id));
    // The newest readable version that names where it was forked from.
    const parentId = versions.find(version => version.forkedFromPricingId !== null)?.forkedFromPricingId;
    if (!parentId) return 'NOT_A_FORK';
    const pricing = await this.findPricing(parentId);
    const viewer = pricing && (await this.viewerOf(user, pricing));
    if (!pricing || !viewer?.reader) return 'PARENT_UNAVAILABLE';
    return { fork, versions, pricing, viewer };
  }

  private async requireForkContext(user: LeanUser, forkPricingId: string): Promise<ForkContext> {
    const context = await this.forkContext(user, forkPricingId);
    if (context === 'NOT_A_FORK') {
      throw new PullRequestError(422, 'NOT_A_FORK', 'This pricing was not forked from another one');
    }
    if (context === 'PARENT_UNAVAILABLE') {
      throw new PullRequestError(404, 'PARENT_UNAVAILABLE', 'The pricing this fork was made from is not available');
    }
    return context;
  }

  /** The ids of the versions of a pricing the caller may read, as `show()` decides; null if none. */
  private async readableVersionIds(user: LeanUser, identity: PricingIdentityRef): Promise<Set<string> | null> {
    let shown;
    try {
      shown = await this.pricingService.show(identity.slug, identity.organizationId, user);
    } catch (error) {
      if ((error as Error).message.startsWith('NOT FOUND')) return null;
      throw error;
    }
    // A slug can name another pricing of the organization in another collection.
    if (String(shown.pricingId) !== identity.pricingId) return null;
    return new Set(shown.versions.map(version => String(version.id)));
  }

  /** Proposals from one fork to one parent run one after the other (in this API process). */
  private inForkQueue<T>(context: ForkContext, operation: () => Promise<T>): Promise<T> {
    // Prefixed, so it can never be the queue of a pricing's own revision.
    return withPricingRevisionLock(`pr-fork:${context.fork.pricingId}:${context.pricing.pricingId}`, operation);
  }

  private pullRequestExists(open: PricingPullRequest) {
    return new PullRequestError(409, 'PULL_REQUEST_EXISTS', `Pull request #${open.number} from this fork is already open`, {
      number: open.number,
    });
  }

  /**
   * The versions of F a proposal merges: the newest one the caller may read is
   * the proposal; the base is the version of F the parent last took in (the one
   * the latest merged pull request from F proposed, while F keeps it), or else
   * the newest version of F copied from P. `previouslyMerged` names the latest
   * pull request from F that was merged.
   */
  private async forkSides(context: ForkContext): Promise<{ base: ForkVersion; proposal: ForkVersion; previouslyMerged?: number }> {
    const { fork, versions, pricing } = context;
    const proposal = versions[0];
    const merged = await this.pricingPullRequestRepository.findMergedFromFork(pricing.pricingId, fork.pricingId);
    const previouslyMerged = merged[0]?.number;
    for (const pullRequest of merged) {
      const taken = versions.find(version => version.id === pullRequest.origin?.versionId);
      if (taken) return { base: taken, proposal, previouslyMerged };
    }
    const copied = versions.find(version => version.forkedFromPricingId === pricing.pricingId)!;
    return { base: copied, proposal, previouslyMerged };
  }

  /** Reads the files of a merge's three versions, each once. */
  private async inputsOf(base: StoredVersion, current: StoredVersion, proposal: StoredVersion) {
    const read = new Map<string, Promise<StoredText>>();
    const text = (version: StoredVersion) => {
      if (!read.has(version.id)) read.set(version.id, this.readStored(version));
      return read.get(version.id)!;
    };
    const [baseText, currentText, proposalText] = await Promise.all([text(base), text(current), text(proposal)]);
    return { inputs: { base: baseText, current: currentText, proposal: proposalText }, currentRaw: currentText.raw };
  }

  /** A result typed by hand: within the limits, in the latest syntax and accepted by the parser. */
  private loadManual(text: string): LoadedText {
    const manual = normalizeProposalText(text, limits().proposalBytes);
    const { validation, parsed } = validate(manual.text);
    if (!validation.ok) throw new PullRequestError(400, 'INVALID_PRICING', validation.error!, validation.line !== undefined ? { line: validation.line } : {});
    return { ...manual, parsed };
  }

  /**
   * Merges the inputs and applies the caller's choices (`manual` over
   * `resolutions` over the computed merge). The result keeps the proposal's
   * text when it is the proposal, and the target's when it adds nothing;
   * anything else is written again. It always carries P's name.
   */
  private computeResult(
    pricing: TargetPricing,
    inputs: MergeInputs,
    resolutions: Record<string, unknown>,
    manual: LoadedText | undefined,
    requireAll: boolean
  ): ComputedResult {
    const output = mergePricingDocs(inputs.base.doc, inputs.current.doc, inputs.proposal.doc);
    const resolved = applyResolutions(output, resolutions, { requireAll, manual: manual?.doc });
    const proposalVersion = inputs.proposal.doc.version;

    let source: LoadedText;
    if (manual) source = manual;
    else if (resolved.outcome === 'proposal-only') source = inputs.proposal;
    else if (resolved.outcome === 'no-changes') source = inputs.current;
    else {
      // The merge keeps the current version's label; the proposal names its own.
      const doc = proposalVersion === undefined ? resolved.doc : { ...resolved.doc, version: proposalVersion };
      source = { text: dumpPricingDoc(doc), doc, regenerated: true };
    }
    const stamped = this.withName(source, pricing.name);
    // Stamping already parsed the text it returns; only a refused one is parsed again, for its error.
    const { validation, version } = stamped.pricing
      ? { validation: { ok: true }, version: String(stamped.pricing.version) }
      : validate(stamped.text);

    const warnings: PullRequestWarning[] = [];
    if ([inputs.base, inputs.current, inputs.proposal, manual].some(text => text?.regenerated)) warnings.push({ code: 'SYNTAX_UPGRADED' });
    warnings.push(...resolved.warnings);
    if (stamped.regenerated && !warnings.some(warning => warning.code === 'FORMAT_REGENERATED')) {
      warnings.push({ code: 'FORMAT_REGENERATED' });
    }
    return {
      output,
      outcome: resolved.outcome,
      text: stamped.text,
      regenerated: source.regenerated || stamped.regenerated,
      validation,
      suggestedVersion: version ?? String(proposalVersion ?? ''),
      warnings,
    };
  }

  /**
   * The result with P's name. Stamping verifies the text with the parser; a
   * result the parser refuses is still shown (written again with the name), so
   * the caller sees why it cannot be submitted.
   */
  private withName(source: LoadedText, name: string): { text: string; regenerated: boolean; pricing?: ParsedPricing } {
    try {
      return stampTopLevel(source.text, { saasName: name }, { loaded: source.loaded, parsed: source.parsed });
    } catch (error) {
      if (!(error instanceof PricingYamlError) || error.code !== 'INVALID_PRICING') throw error;
      return { text: dumpPricingDoc({ ...source.doc, saasName: name }), regenerated: true };
    }
  }

  private previewOf(
    result: ComputedResult,
    base: { id: string; version: string },
    target: { id: string; version: string },
    payload: PreviewPayload,
    previouslyMerged?: number
  ): PullRequestPreviewDTO {
    return {
      base,
      target,
      outcome: result.outcome,
      conflicts: result.output.conflicts,
      resultYaml: result.text,
      regenerated: result.regenerated,
      validation: result.validation,
      warnings: previouslyMerged === undefined ? result.warnings : [...result.warnings, { code: 'PREVIOUSLY_MERGED', number: previouslyMerged }],
      previewToken: signPreview(payload),
      suggestedVersion: result.suggestedVersion,
    };
  }

  /**
   * Checks that a preview token is this server's, for this caller and subject,
   * and computed from the same inputs. When only the target moved on, the
   * caller gets `targetMoved`: which public version is the latest now, or for a
   * merge that there is a newer version than the one reviewed.
   */
  private checkPreview(token: unknown, expected: PreviewPayload, targetMoved: () => PullRequestError) {
    const given = readPreview(token);
    const same = (key: keyof PreviewPayload) => given?.[key] === expected[key];
    if (!given || !(['purpose', 'subjectId', 'viewerId', 'baseRef', 'proposalRef'] as const).every(same)) throw previewStale();
    if (!same('targetVersionId')) throw targetMoved();
  }

  private requireValid(result: ComputedResult) {
    if (!result.validation.ok) {
      throw new PullRequestError(400, 'INVALID_PRICING', result.validation.error!, result.validation.line !== undefined ? { line: result.validation.line } : {});
    }
  }

  /** The latest public version, which a pull request that is not up to date is brought to. */
  private requireBehind(pullRequest: PricingPullRequest, pricing: TargetPricing): StoredVersion {
    const latestPublic = this.requireLatestPublic(pricing);
    if (pullRequest.base.versionId === latestPublic.id) {
      throw new PullRequestError(409, 'PULL_REQUEST_UP_TO_DATE', 'The pull request already starts from the latest public version');
    }
    return latestPublic;
  }

  /** A pull request the caller may see: its author while they read P, or a maintainer of P. */
  private async loadPullRequest(user: LeanUser, id: string): Promise<LoadedPullRequest> {
    const stored = await this.pricingPullRequestRepository.findById(id);
    const pricing = stored && (await this.findPricing(stored.pricingId));
    if (!stored || !pricing) throw notFound();
    const pullRequest = await this.reconcileMerge(stored);
    const viewer = await this.viewerOf(user, pricing);
    const visible = (pullRequest.authorId === user.id && viewer.reader) || viewer.maintainer;
    if (!visible) throw notFound();
    return { pullRequest, pricing, viewer };
  }

  private async findPricing(pricingId: string): Promise<TargetPricing | null> {
    const identity = await this.pricingRepository.findIdentity(pricingId);
    const latest = identity && (await this.pricingRepository.findLatestVersion(identity.pricingId));
    if (!identity || !latest) return null;
    return {
      ...identity,
      collectionSlug: await this.pricingCollectionRepository.findSlugById(identity.collectionId),
      latest,
      latestPublic: latest.private
        ? await this.pricingRepository.findLatestVersion(identity.pricingId, { publicOnly: true })
        : latest,
    };
  }

  private async viewerOf(user: LeanUser, pricing: TargetPricing): Promise<Viewer> {
    const readsPrivate = await this.permissionService.canReadPrivateVersions(
      user,
      { organizationId: pricing.organizationId, slug: pricing.slug, collectionSlug: pricing.collectionSlug },
      'token'
    );
    const reader = pricing.latestPublic !== null || readsPrivate;
    // Merging combines with the latest version, which may be private.
    const hasPrivate = pricing.latest.private || (await this.pricingRepository.hasPrivateVersion(pricing.pricingId));
    const maintainer = (readsPrivate || !hasPrivate) && (await this.mayPublishVersions(user, pricing));
    return { user, reader, readsPrivate, maintainer };
  }

  /** CREATE on P, evaluated as publishing a version does (`PricingService._createPricingVersion`). */
  private async mayPublishVersions(user: LeanUser, pricing: { organizationId: string; slug: string }): Promise<boolean> {
    const isGlobalAdmin = user.role === 'ADMIN';
    const orgRole = await this.permissionService.resolveOrgRole(user.id, pricing.organizationId);
    const batch = await this.permissionService.buildBatchContext(user.id, pricing.organizationId, orgRole, isGlobalAdmin);
    return this.permissionEngine.evaluate({
      userId: user.id,
      organizationId: pricing.organizationId,
      entityType: 'pricing',
      entitySlug: pricing.slug,
      action: 'CREATE',
      userOrgRole: orgRole,
      isGlobalAdmin,
      entityPermissions: batch.entityPermissions.get(`pricing:${pricing.slug}`),
    }).allowed;
  }

  /** The first limit the caller reached for P, if any. */
  private async limitReached(user: LeanUser, pricingId: string): Promise<ProposalBlock | null> {
    const max = limits();
    if ((await this.pricingPullRequestRepository.countOpen(pricingId, user.id)) >= max.openPerAuthor) return 'AUTHOR_LIMIT';
    if ((await this.pricingPullRequestRepository.countOpen(pricingId)) >= max.openPerPricing) return 'PRICING_LIMIT';
    const since = new Date(Date.now() - DAY_MS);
    if ((await this.pricingPullRequestRepository.countCreatedSince(user.id, since)) >= max.createdPerDay) return 'DAILY_LIMIT';
    return null;
  }

  /** In the order creating one checks them. */
  private async proposalBlock(user: LeanUser, pricing: TargetPricing): Promise<ProposalBlock | null> {
    return (await this.limitReached(user, pricing.pricingId)) ?? (pricing.latestPublic ? null : 'NO_PUBLIC_VERSION');
  }

  private requireLatestPublic(pricing: TargetPricing): StoredVersion {
    if (!pricing.latestPublic) {
      throw new PullRequestError(409, 'NO_PUBLIC_VERSION', 'There is no public version to base a pull request on');
    }
    return pricing.latestPublic;
  }

  private assertOpen(pullRequest: PricingPullRequest) {
    if (pullRequest.status !== 'open') throw notOpen();
    if (lockIsLive(pullRequest)) {
      throw new PullRequestError(409, 'PULL_REQUEST_MERGING', 'The pull request is being merged');
    }
  }

  /**
   * Why a conditional change of a pull request found nothing to change. A change
   * made from a preview is told its preview is stale when the proposal moved on.
   */
  private async refusalOf(id: string, fromPreview = false): Promise<PullRequestError> {
    const current = await this.pricingPullRequestRepository.findById(id);
    if (!current || current.status !== 'open') return notOpen();
    if (lockIsLive(current)) return new PullRequestError(409, 'PULL_REQUEST_MERGING', 'The pull request is being merged');
    if (fromPreview) return previewStale();
    return new PullRequestError(409, 'PULL_REQUEST_CHANGED', 'The pull request changed meanwhile; reload it and try again');
  }

  /**
   * A proposal as it is stored: loaded within the limits, in the latest syntax,
   * accepted by the parser and with P's name.
   */
  private prepareProposal(text: string, pricing: TargetPricing) {
    const normalized = normalizeProposalText(text, limits().proposalBytes);
    let parsed;
    try {
      parsed = retrievePricingFromText(normalized.text);
    } catch (error) {
      throw new PullRequestError(400, 'INVALID_PRICING', (error as Error)?.message ?? String(error));
    }
    // A proposal that already carries P's name is not parsed again.
    const stamped = stampTopLevel(normalized.text, { saasName: pricing.name }, { loaded: normalized.loaded, parsed });
    const warnings: PullRequestWarning[] = [];
    if (normalized.regenerated) warnings.push({ code: 'SYNTAX_UPGRADED' });
    else if (stamped.regenerated) warnings.push({ code: 'FORMAT_REGENERATED' });
    return { text: stamped.text, doc: normalized.doc, suggestedVersion: String(parsed.version), warnings };
  }

  /**
   * A stored version's file and its document in the latest syntax. Reading a
   * file in an older syntax elsewhere rewrites it (pricing4ts), so a read that
   * does not load is tried once more.
   */
  private async readStored(version: StoredVersion): Promise<StoredText> {
    const file = requirePricingFile(version.yaml);
    for (let attempt = 0; ; attempt++) {
      if ((await fs.stat(file)).size > STORED_PRICING_MAX_BYTES) {
        throw new PricingYamlError(413, 'PRICING_TOO_LARGE', `The pricing may take at most ${STORED_PRICING_MAX_BYTES} bytes`);
      }
      const raw = await fs.readFile(file, 'utf8');
      try {
        return { raw, ...this.loadStored(raw) };
      } catch (error) {
        if (attempt >= 1) throw error;
      }
    }
  }

  /** A text SPHERE stored (a version's file, or a pull request's base or proposal), in the latest syntax. */
  private loadStored(text: string): LoadedText {
    return normalizeProposalText(text, STORED_PRICING_MAX_BYTES);
  }

  private storedDoc(text: string): PricingDoc {
    return this.loadStored(text).doc;
  }

  /** What a pull request is compared with: the latest version for a maintainer, the latest public one for anyone else. */
  private targetOf(pricing: TargetPricing, viewer: Viewer): StoredVersion | null {
    return viewer.maintainer ? pricing.latest : pricing.latestPublic;
  }

  /** The target's document, read at most once per request. */
  private targetDocOf(pricing: TargetPricing, viewer: Viewer) {
    const target = this.targetOf(pricing, viewer);
    return once(async () => (await this.readStored(target!)).doc);
  }

  private async stateOf(
    pullRequest: PricingPullRequest,
    pricing: TargetPricing,
    viewer: Viewer,
    targetDoc: () => Promise<PricingDoc>
  ): Promise<PullRequestState> {
    if (pullRequest.status === 'merged') return { kind: 'merged' };
    if (pullRequest.status === 'closed') return { kind: 'closed' };
    const target = this.targetOf(pricing, viewer);
    if (!target) return { kind: 'no-public-version' };
    const onTarget = target.id === pullRequest.base.versionId;

    // Every input is fixed by these ids (P's name, the only thing that can change, is not compared).
    const key = [pullRequest.id, pullRequest.proposalRevision, pullRequest.base.versionId, target.id].join(':');
    let summary = this.states.get(key);
    if (!summary) {
      const base = this.storedDoc(pullRequest.base.yaml);
      const merge = mergePricingDocs(base, onTarget ? base : await targetDoc(), this.storedDoc(pullRequest.proposed.yaml));
      summary = { outcome: merge.outcome, conflicts: merge.conflicts.length };
      this.states.set(key, summary);
    }
    // A proposal that adds nothing to its target has no changes, on the target or behind it.
    if (summary.outcome === 'no-changes') return { kind: 'no-changes' };
    return onTarget ? { kind: 'up-to-date' } : { kind: 'behind', conflicts: summary.conflicts };
  }

  private async authorsOf(pullRequests: PricingPullRequest[]): Promise<Map<string, string>> {
    const ids = [...new Set(pullRequests.map(pullRequest => pullRequest.authorId))];
    if (ids.length === 0) return new Map();
    const users = await this.userRepository.findByIds(ids);
    return new Map(users.map(author => [String(author.id), author.username]));
  }

  private async summaryOf(
    pullRequest: PricingPullRequest,
    pricing: TargetPricing,
    viewer: Viewer,
    authors: Map<string, string>,
    targetDoc: () => Promise<PricingDoc>
  ): Promise<PullRequestSummaryDTO> {
    const username = authors.get(pullRequest.authorId);
    const merged = await this.mergedOf(pullRequest, pricing, viewer);
    return {
      id: pullRequest.id,
      pricingId: pullRequest.pricingId,
      number: pullRequest.number,
      title: pullRequest.title,
      status: pullRequest.status,
      author: username === undefined ? null : { id: pullRequest.authorId, username },
      base: { versionId: pullRequest.base.versionId, version: pullRequest.base.version },
      proposed: { suggestedVersion: pullRequest.proposed.suggestedVersion },
      proposalRevision: pullRequest.proposalRevision,
      state: await this.stateOf(pullRequest, pricing, viewer, targetDoc),
      ...(merged ? { merged } : {}),
      ...(pullRequest.closed
        ? {
          closed: {
            kind: pullRequest.closed.kind,
            at: pullRequest.closed.at,
            ...(pullRequest.closed.reason !== undefined ? { reason: pullRequest.closed.reason } : {}),
          },
        }
        : {}),
      createdAt: pullRequest.createdAt,
      updatedAt: pullRequest.updatedAt,
    };
  }

  private async detailOf({ pullRequest, pricing, viewer }: LoadedPullRequest): Promise<PullRequestDetailDTO> {
    const authors = await this.authorsOf([pullRequest]);
    const summary = await this.summaryOf(pullRequest, pricing, viewer, authors, this.targetDocOf(pricing, viewer));
    const origin = await this.originOf(pullRequest, viewer);
    return {
      ...summary,
      description: pullRequest.description,
      base: { ...summary.base, yaml: pullRequest.base.yaml, ...this.normalizedBaseOf(pullRequest) },
      proposed: { ...summary.proposed, yaml: pullRequest.proposed.yaml },
      ...(origin ? { origin } : {}),
      permissions: this.permissionsOf(pullRequest, pricing, viewer, summary.state),
    };
  }

  /**
   * A base stored in an older syntax, as the proposal is stored (upgraded): what the
   * detail compares the proposal with, so the upgrade is not shown as the author's change.
   * Computed once per base: the stored base only changes with the proposal revision.
   */
  private normalizedBaseOf(pullRequest: PricingPullRequest): { normalizedYaml?: string } {
    const key = [pullRequest.id, pullRequest.proposalRevision, pullRequest.base.versionId].join(':');
    const cached = this.normalizedBases.get(key);
    if (cached) return cached;
    let normalized: { normalizedYaml?: string } = {};
    try {
      const loaded = this.loadStored(pullRequest.base.yaml);
      if (loaded.regenerated) normalized = { normalizedYaml: loaded.text };
    } catch {
      // A base that does not load is shown as stored.
    }
    this.normalizedBases.set(key, normalized);
    return normalized;
  }

  /** The merged version is named only to who may read it now. */
  private async mergedOf(pullRequest: PricingPullRequest, pricing: TargetPricing, viewer: Viewer) {
    if (!pullRequest.merged) return undefined;
    const { at, versionId, version } = pullRequest.merged;
    const stored = await this.pricingRepository.findVersionOf(pricing.pricingId, versionId);
    const readable = stored !== null && (!stored.private || viewer.readsPrivate);
    return readable ? { at, versionId, version } : { at };
  }

  /**
   * The fork a proposal came from, as `show()` lets the caller read it: never
   * the version of the fork the merge started from, and the proposed version
   * only if the caller may read it.
   */
  private async originOf(pullRequest: PricingPullRequest, viewer: Viewer): Promise<PullRequestOriginDTO | undefined> {
    const origin = pullRequest.origin;
    const location = origin && (await this.pricingRepository.findLocation(origin.pricingId));
    if (!origin || !location) return undefined;
    let fork;
    try {
      fork = await this.pricingService.show(location.slug, location.organizationId, viewer.user);
    } catch (error) {
      if ((error as Error).message.startsWith('NOT FOUND')) return undefined;
      throw error;
    }
    // A slug can name another pricing of the organization in another collection.
    if (String(fork.pricingId) !== origin.pricingId) return undefined;
    const version = fork.versions.find(candidate => String(candidate.id) === origin.versionId);
    const organization = (fork.versions[0] as any)?.organization ?? {};
    return {
      pricingId: origin.pricingId,
      name: fork.name,
      slug: fork.slug,
      organization: {
        id: String(organization.id ?? location.organizationId),
        name: organization.name ?? '',
        displayName: organization.displayName ?? organization.name ?? '',
      },
      ...(version ? { versionId: origin.versionId, version: String((version as any).version) } : {}),
      editedAfterProposal: origin.edited,
    };
  }

  private permissionsOf(
    pullRequest: PricingPullRequest,
    pricing: TargetPricing,
    viewer: Viewer,
    state: PullRequestState
  ): PullRequestPermissions {
    const isAuthor = pullRequest.authorId === viewer.user.id;
    const open = pullRequest.status === 'open' && !lockIsLive(pullRequest);
    const onLatestPublic = pricing.latestPublic !== null && pullRequest.base.versionId === pricing.latestPublic.id;
    return {
      edit: open && isAuthor,
      editProposal: open && isAuthor && onLatestPublic,
      update: open && isAuthor && pricing.latestPublic !== null && !onLatestPublic,
      close: open && (isAuthor || viewer.maintainer),
      // A maintainer's state compares with the latest version: merging it would add nothing.
      merge: open && viewer.maintainer && state.kind !== 'no-changes',
    };
  }
}

export default PricingPullRequestService;
