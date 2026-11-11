import fs from 'fs/promises';
import { retrievePricingFromText } from 'pricing4ts/server';
import container from '../config/container';
import { PermissionEngine } from '../policies/PermissionEngine';
import PricingCollectionRepository from '../repositories/mongoose/PricingCollectionRepository';
import PricingPullRequestRepository from '../repositories/mongoose/PricingPullRequestRepository';
import PricingRepository, { PricingIdentityRef, StoredVersion } from '../repositories/mongoose/PricingRepository';
import UserRepository from '../repositories/mongoose/UserRepository';
import {
  PricingPullRequest,
  ProposalBlock,
  PullRequestChanges,
  PullRequestDetailDTO,
  PullRequestError,
  PullRequestListDTO,
  PullRequestOriginDTO,
  PullRequestPermissions,
  PullRequestState,
  PullRequestStatus,
  PullRequestSummaryDTO,
  PullRequestWarning,
} from '../types/models/PricingPullRequest';
import { LeanUser } from '../types/models/User';
import { requirePricingFile } from '../utils/pricing-files';
import { MergeOutcome, mergePricingDocs } from '../utils/pricing-merge';
import {
  loadPricingDoc,
  normalizeProposalText,
  PricingDoc,
  PricingYamlError,
  STORED_PRICING_MAX_BYTES,
  upgradeToLatestSyntax,
} from '../utils/pricing-syntax';
import { stampTopLevel } from '../utils/pricing-top-level';
import PermissionService from './PermissionService';
import PricingService from './PricingService';

const PAGE_SIZE = 20;
/** States computed for the listings, by pull request, proposal, base and target. */
const STATE_CACHE_ENTRIES = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A JSON body takes at most 2 MB and escaping can almost double a text, so a proposal stays within 1 MiB. */
const MAX_PROPOSAL_BYTES = 1024 * 1024;

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
  proposalBytes: Math.min(limitFromEnv('PRICING_PR_MAX_YAML_BYTES', MAX_PROPOSAL_BYTES), MAX_PROPOSAL_BYTES),
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

export interface NewPullRequestBody {
  title: string;
  description?: string;
  source: { kind: 'text'; pricingId: string; baseVersionId: string; proposedYaml: string };
}

export interface PullRequestEdit {
  title?: string;
  description?: string;
  proposedYaml?: string;
}

/** A small least-recently-used map. */
class StateCache {
  private entries = new Map<string, MergeSummary>();

  get(key: string): MergeSummary | undefined {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: MergeSummary) {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > STATE_CACHE_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
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
  private permissionEngine = new PermissionEngine();
  private states = new StateCache();

  constructor() {
    this.pricingPullRequestRepository = container.resolve('pricingPullRequestRepository');
    this.pricingRepository = container.resolve('pricingRepository');
    this.pricingCollectionRepository = container.resolve('pricingCollectionRepository');
    this.userRepository = container.resolve('userRepository');
    this.permissionService = container.resolve('permissionService');
    this.pricingService = container.resolve('pricingService');
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
      base: { versionId: latestPublic.id, version: latestPublic.version, yaml: baseText.text },
      proposed: { yaml: proposal.text, suggestedVersion: proposal.suggestedVersion },
    });
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
      update.proposed = { yaml: proposal.text, suggestedVersion: proposal.suggestedVersion };
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
    return this.detailOf({ ...loaded, pullRequest: closed });
  }

  /** A pull request the caller may see: its author while they read P, or a maintainer of P. */
  private async loadPullRequest(user: LeanUser, id: string): Promise<LoadedPullRequest> {
    const pullRequest = await this.pricingPullRequestRepository.findById(id);
    const pricing = pullRequest && (await this.findPricing(pullRequest.pricingId));
    if (!pullRequest || !pricing) throw notFound();
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
  private async mayPublishVersions(user: LeanUser, pricing: TargetPricing): Promise<boolean> {
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
    if (pullRequest.status !== 'open') {
      throw new PullRequestError(409, 'PULL_REQUEST_NOT_OPEN', 'The pull request is no longer open');
    }
    if (lockIsLive(pullRequest)) {
      throw new PullRequestError(409, 'PULL_REQUEST_MERGING', 'The pull request is being merged');
    }
  }

  /** Why a conditional change of a pull request found nothing to change. */
  private async refusalOf(id: string): Promise<PullRequestError> {
    const current = await this.pricingPullRequestRepository.findById(id);
    if (!current || current.status !== 'open') {
      return new PullRequestError(409, 'PULL_REQUEST_NOT_OPEN', 'The pull request is no longer open');
    }
    if (lockIsLive(current)) return new PullRequestError(409, 'PULL_REQUEST_MERGING', 'The pull request is being merged');
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
    const stamped = stampTopLevel(normalized.text, { saasName: pricing.name });
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
  private async readStored(version: StoredVersion): Promise<{ text: string; doc: PricingDoc }> {
    const file = requirePricingFile(version.yaml);
    for (let attempt = 0; ; attempt++) {
      if ((await fs.stat(file)).size > STORED_PRICING_MAX_BYTES) {
        throw new PricingYamlError(413, 'PRICING_TOO_LARGE', `The pricing may take at most ${STORED_PRICING_MAX_BYTES} bytes`);
      }
      const text = await fs.readFile(file, 'utf8');
      try {
        return { text, doc: this.storedDoc(text) };
      } catch (error) {
        if (attempt >= 1) throw error;
      }
    }
  }

  private storedDoc(text: string): PricingDoc {
    return upgradeToLatestSyntax(loadPricingDoc(text, STORED_PRICING_MAX_BYTES)).doc;
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
    if (target.id === pullRequest.base.versionId) return { kind: 'up-to-date' };

    // Every input is fixed by these ids (P's name, the only thing that can change, is not compared).
    const key = [pullRequest.id, pullRequest.proposalRevision, pullRequest.base.versionId, target.id].join(':');
    let summary = this.states.get(key);
    if (!summary) {
      const merge = mergePricingDocs(
        this.storedDoc(pullRequest.base.yaml),
        await targetDoc(),
        this.storedDoc(pullRequest.proposed.yaml)
      );
      summary = { outcome: merge.outcome, conflicts: merge.conflicts.length };
      this.states.set(key, summary);
    }
    return summary.outcome === 'no-changes' ? { kind: 'no-changes' } : { kind: 'behind', conflicts: summary.conflicts };
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
      base: { ...summary.base, yaml: pullRequest.base.yaml },
      proposed: { ...summary.proposed, yaml: pullRequest.proposed.yaml },
      ...(origin ? { origin } : {}),
      permissions: this.permissionsOf(pullRequest, pricing, viewer),
    };
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

  private permissionsOf(pullRequest: PricingPullRequest, pricing: TargetPricing, viewer: Viewer): PullRequestPermissions {
    const isAuthor = pullRequest.authorId === viewer.user.id;
    const open = pullRequest.status === 'open' && !lockIsLive(pullRequest);
    const onLatestPublic = pricing.latestPublic !== null && pullRequest.base.versionId === pricing.latestPublic.id;
    return {
      edit: open && isAuthor,
      editProposal: open && isAuthor && onLatestPublic,
      update: open && isAuthor && pricing.latestPublic !== null && !onLatestPublic,
      close: open && (isAuthor || viewer.maintainer),
      merge: open && viewer.maintainer,
    };
  }
}

export default PricingPullRequestService;
