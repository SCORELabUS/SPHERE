import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import container from '../config/container';
import PricingAnonymousLinkRepository, {
  ShareableVersion,
  StoredAnonymousLink,
} from '../repositories/mongoose/PricingAnonymousLinkRepository';
import PricingRepository from '../repositories/mongoose/PricingRepository';
import PricingIdentity from '../repositories/mongoose/models/PricingIdentityMongoose';
import PricingMongoose from '../repositories/mongoose/models/PricingMongoose';
import PermissionService from './PermissionService';
import { LeanUser } from '../types/models/User';
import {
  ANONYMOUS_ANALYTICS_KEYS,
  ANONYMOUS_TOKEN_BYTES,
  ANONYMOUS_TOKEN_PATTERN,
  AnonymousLinkView,
  AnonymousPricing,
  MAX_ANONYMOUS_LINKS_PER_PRICING,
  MAX_ANONYMOUS_YAML_BYTES,
} from '../types/models/PricingAnonymousLink';
import { readPricingFile } from '../utils/pricing-files';
import { withPricingRevisionLock } from '../utils/pricing-revision-lock';

/** What a link shows once resolved: the public answer and the bytes of its file. */
export interface ResolvedAnonymousLink {
  pricing: AnonymousPricing;
  file: Buffer;
}

interface PricingFamily {
  pricingId: string;
  organizationId: string;
  slug: string;
  pricing: any;
}

/**
 * Anonymous links show one version of a pricing to anyone holding a random
 * token, without anything that names who published it. Who may edit the
 * pricing (`checkPricingPut`, with its collection's PUT authority) creates,
 * lists and revokes them; a private version is never shared this way, and a
 * link stops answering while its version is private (it answers again when it
 * is not). The public answer is the same for every caller: the routes drop
 * any credentials (AnonymousAccessMiddleware) and nothing here reads a user.
 */
class PricingAnonymousLinkService {
  private repository: PricingAnonymousLinkRepository;
  private pricingRepository: PricingRepository;
  private permissionService: PermissionService;
  /** Replaceable in tests that pause the read to change the link meanwhile. */
  readFile = (stored: string) => readPricingFile(stored, MAX_ANONYMOUS_YAML_BYTES);

  constructor() {
    this.repository = container.resolve('pricingAnonymousLinkRepository');
    this.pricingRepository = container.resolve('pricingRepository');
    this.permissionService = container.resolve('permissionService');
  }

  async list(reqUser: LeanUser, pricingId: unknown): Promise<{ links: AnonymousLinkView[]; limit: number }> {
    const family = await this._family(reqUser, pricingId);
    await this._assertCanEdit(reqUser, family);
    const links = await this.repository.listByPricing(family.pricingId);
    const versions = await this.repository.findVersions(links.map(link => link.versionId));
    return {
      links: links.flatMap(link => {
        const version = versions.get(String(link.versionId));
        return version ? [this._view(link, version)] : [];
      }),
      limit: MAX_ANONYMOUS_LINKS_PER_PRICING,
    };
  }

  async create(reqUser: LeanUser, versionId: unknown): Promise<AnonymousLinkView> {
    const version: any = typeof versionId === 'string' && mongoose.isValidObjectId(versionId)
      ? await PricingMongoose.findById(versionId).select('pricingId version private').lean()
      : null;
    if (!version?.pricingId) throw new Error('NOT FOUND: Pricing version not found');
    const family = await this._family(reqUser, version.pricingId);
    if (version.private === true && !(await this._canReadPrivate(reqUser, family))) {
      throw new Error('NOT FOUND: Pricing version not found');
    }
    await this._assertCanEdit(reqUser, family);
    if (version.private === true) {
      throw new Error('CONFLICT: A private version cannot be shared through an anonymous link. Make it visible first.');
    }

    // Its own queue, so counting and creating cannot interleave, without
    // touching the pricing's revision (a link is not a change to the pricing).
    return withPricingRevisionLock(`anonymous-links:${family.pricingId}`, async () => {
      if ((await this.repository.countByPricing(family.pricingId)) >= MAX_ANONYMOUS_LINKS_PER_PRICING) {
        throw new Error(`CONFLICT: This pricing already has ${MAX_ANONYMOUS_LINKS_PER_PRICING} anonymous links. Revoke one to create another.`);
      }
      for (let attempt = 0; ; attempt++) {
        try {
          const link = await this.repository.create({
            token: this.generateToken(), pricingId: family.pricingId, versionId: version._id, createdBy: reqUser.id,
          });
          // The version may have been deleted (its cleanup ran before the link
          // existed) or made private since it was read: take the link back, so it
          // never holds a slot unseen nor answers as active over a private version.
          const current = await this.repository.versionState(version._id, family.pricingId);
          if (!current || current.private) {
            await this.repository.deleteById(link._id);
            if (!current) throw new Error('NOT FOUND: Pricing version not found');
            throw new Error('CONFLICT: A private version cannot be shared through an anonymous link. Make it visible first.');
          }
          return this._view(link, { version: version.version, private: false });
        } catch (err: any) {
          // A token taken already: 192 random bits make it next to impossible, but never fatal.
          if (err?.code !== 11000 || attempt >= 2) throw err;
        }
      }
    });
  }

  /** Revokes a link. A link the caller may not manage answers like one that does not exist. */
  async revoke(reqUser: LeanUser, linkId: unknown): Promise<void> {
    const link = typeof linkId === 'string' ? await this.repository.findById(linkId) : null;
    if (!link) throw new Error('NOT FOUND: Anonymous link not found');
    try {
      const family = await this._family(reqUser, link.pricingId);
      await this._assertCanEdit(reqUser, family);
    } catch {
      throw new Error('NOT FOUND: Anonymous link not found');
    }
    await this.repository.deleteById(link._id);
  }

  /**
   * What a token shows, or null for any token that does not show anything
   * now (malformed, never created, revoked, a private, deleted or changed
   * version, a deleted pricing, an unreadable file), so all of them answer
   * alike.
   */
  async resolve(token: unknown): Promise<ResolvedAnonymousLink | null> {
    if (typeof token !== 'string' || !ANONYMOUS_TOKEN_PATTERN.test(token)) return null;
    const link = await this.repository.findByToken(token);
    if (!link) return null;
    const version = await this.repository.findShareableVersion(link);
    if (!version) return null;
    let file: Buffer;
    try {
      file = await this.readFile(version.yaml);
    } catch {
      return null;
    }
    // A revocation or a visibility change while the file was read must not release it.
    if (!(await this.repository.isStillShareable(link, version))) return null;
    return { pricing: this._publicView(version, file), file };
  }

  generateToken(): string {
    return randomBytes(ANONYMOUS_TOKEN_BYTES).toString('base64url');
  }

  private _view(link: StoredAnonymousLink, version: { version: string; private: boolean }): AnonymousLinkView {
    return {
      id: String(link._id),
      token: link.token,
      versionId: String(link.versionId),
      version: version.version,
      createdAt: link.createdAt,
      active: !version.private,
    };
  }

  /** The closed list of keys anyone gets: never an id, a path, a name of whoever published it, or a fork's origin. */
  private _publicView(version: ShareableVersion, file: Buffer): AnonymousPricing {
    const analytics: AnonymousPricing['analytics'] = {};
    for (const key of ANONYMOUS_ANALYTICS_KEYS) {
      const value = (version.analytics as Record<string, unknown> | undefined)?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) analytics[key] = value;
    }
    return { version: version.version, createdAt: version.createdAt, analytics, yaml: file.toString('utf8') };
  }

  /**
   * A live pricing the caller may read: a pricing with private versions only
   * answers like a missing one to who may not read them.
   */
  private async _family(reqUser: LeanUser, pricingId: unknown): Promise<PricingFamily> {
    if (!mongoose.isValidObjectId(pricingId)) throw new Error('NOT FOUND: Pricing not found');
    const identity: any = await PricingIdentity.findOne({ _id: pricingId, deleted: false }).lean();
    if (!identity) throw new Error('NOT FOUND: Pricing not found');
    const organizationId = String(identity._organizationId);
    const pricing: any = await this.pricingRepository.findOne(identity.slug, organizationId, {
      includePrivate: true, collectionId: identity._collectionId ?? undefined,
    });
    if (!pricing?.versions?.length) throw new Error('NOT FOUND: Pricing not found');
    const family = { pricingId: String(identity._id), organizationId, slug: identity.slug, pricing };
    const hasPublicVersion = pricing.versions.some((version: { private?: boolean }) => version.private !== true);
    if (!hasPublicVersion && !(await this._canReadPrivate(reqUser, family))) throw new Error('NOT FOUND: Pricing not found');
    return family;
  }

  private _canReadPrivate(reqUser: LeanUser, family: PricingFamily) {
    return this.permissionService.canReadPrivateVersions(reqUser, {
      organizationId: family.organizationId, slug: family.slug, collectionSlug: family.pricing.collection?.slug,
    });
  }

  /** Who may change the pricing's visibility manages its links. */
  private async _assertCanEdit(reqUser: LeanUser, family: PricingFamily) {
    const result = await this.permissionService.checkPricingPut(reqUser, family.organizationId, family.slug, {
      pricing: family.pricing,
      isPrivate: family.pricing.versions.some((version: { private?: boolean }) => version.private === true),
    });
    if (!result.allowed) throw new Error(`PERMISSION ERROR: ${result.reason}`);
  }
}

export default PricingAnonymousLinkService;
