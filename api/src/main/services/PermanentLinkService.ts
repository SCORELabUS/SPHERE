import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import mongoose from 'mongoose';
import Pricing from '../repositories/mongoose/models/PricingMongoose';
import Collection from '../repositories/mongoose/models/PricingCollectionMongoose';
import Identity from '../repositories/mongoose/models/PricingIdentityMongoose';
import { PermissionEngine } from '../policies/PermissionEngine';

export function functionalHash(text: string): string {
  const value = yaml.load(text) as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid YAML pricing');
  const { saasName: _name, ...functional } = value;
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) :
    v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(functional))).digest('hex');
}

export default class PermanentLinkService {
  async publicVersions(id: string) {
    if (!mongoose.isObjectIdOrHexString(id)) throw new Error('NOT FOUND');
    const identity = await Identity.findOne({ _id: id, deleted: false }).lean();
    if (!identity) throw new Error('NOT FOUND');
    const versions = await Pricing.find({ pricingId: id, private: false }).sort({ createdAt: -1, _id: -1 }).lean();
    if (!versions.length) throw new Error('NOT FOUND');
    return { identity, versions };
  }

  /**
   * Whether the caller may read the private versions of a pricing family. False
   * for anonymous callers and for anyone the permission rules (API key scopes
   * included) do not allow; never throws for a denied caller.
   */
  async canReadPrivateVersions(identity: any, user?: any, authType?: string) {
    if (!user) return false;
    const collection = identity._collectionId ? await Collection.findById(identity._collectionId).lean() : null;
    try {
      await this.authorize(user, String(identity._organizationId), 'pricing', identity.slug, collection?.slug, authType);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The id of the version a pricing permanent link asks for (`?version=`), when
   * the caller may see it. `requested` is a version id (what the public
   * synchronization API calls `versionId`) or the exact name of a version of the
   * family; an id wins when a value could be both. Anything else (a missing,
   * repeated or malformed value, a version of another family, or a private
   * version the caller may not read) gives `undefined`, exactly as if the link
   * named no version, so the answer never tells whether a hidden version exists.
   */
  private async requestedVersionId(identity: any, requested: unknown, user?: any, authType?: string) {
    if (typeof requested !== 'string' || !requested || requested.length > 256) return undefined;
    // Decided before looking the version up, and only versions the caller may
    // see are looked up: a hidden version can never shadow a visible one, and
    // a hidden version and a missing one take the same queries.
    const visible = await this.canReadPrivateVersions(identity, user, authType) ? {} : { private: false };
    const family = { pricingId: identity._id, ...visible };
    const version = (mongoose.isObjectIdOrHexString(requested)
      ? await Pricing.findOne({ ...family, _id: requested }).select('_id').lean()
      : null) ?? await Pricing.findOne({ ...family, version: requested }).select('_id').lean();
    return version ? String(version._id) : undefined;
  }

  async readYaml(relative: string) {
    const root = await fs.realpath(path.resolve(process.env.SERVER_STATICS_FOLDER || 'public'));
    const file = await fs.realpath(path.resolve(root, relative));
    if (!file.startsWith(root + path.sep)) throw new Error('NOT FOUND');
    const stat = await fs.stat(file);
    if (stat.size > 5 * 1024 * 1024) throw new Error('Pricing exceeds synchronization size limit');
    return fs.readFile(file, 'utf8');
  }

  async manifest(id: string) {
    const { identity, versions } = await this.publicVersions(id);
    const summaries = [];
    for (const version of versions) {
      summaries.push({ versionId: String(version._id), version: version.version,
        createdAt: version.createdAt, contentHash: functionalHash(await this.readYaml(version.yaml)) });
    }
    const visible = await Pricing.find({ pricingId: id, private: false }).select('_id').lean();
    if (visible.length !== versions.length || visible.some(v => !versions.some(original => String(original._id) === String(v._id)))) throw new Error('NOT FOUND');
    return { pricingId: id, name: identity.name, permanentUrl: `${(process.env.SPHERE_PUBLIC_URL || 'https://sphere.score.us.es').replace(/\/$/, '')}/p/${id}`,
      latestVersionId: summaries[0].versionId, versions: summaries };
  }

  async download(id: string, versionId: string) {
    const { versions } = await this.publicVersions(id);
    const version = versions.find(v => String(v._id) === versionId);
    if (!version) throw new Error('NOT FOUND');
    const text = await this.readYaml(version.yaml);
    // A visibility change during file I/O must not release private content.
    if (!await Pricing.exists({ _id: version._id, pricingId: id, private: false })) throw new Error('NOT FOUND');
    return text;
  }

  async archiveEntries(id: string, user?: any, authType?: string) {
    if (!mongoose.isObjectIdOrHexString(id)) throw new Error('NOT FOUND');
    const identity = await Identity.findOne({ _id: id, deleted: false }).lean();
    if (!identity) throw new Error('NOT FOUND');
    const allVersions = await Pricing.find({ pricingId: id }).sort({ createdAt: -1, _id: -1 }).lean();
    if (!allVersions.length) throw new Error('NOT FOUND');

    const hasPrivateVersions = allVersions.some(version => version.private);
    const includePrivateVersions = hasPrivateVersions && Boolean(user);
    if (includePrivateVersions) {
      await this.authorize(user, String(identity._organizationId), 'pricing', identity.slug, undefined, authType);
    }

    const versions = includePrivateVersions ? allVersions : allVersions.filter(version => !version.private);
    if (!versions.length) throw new Error('NOT FOUND');
    const folder = this.archiveName(identity.slug || identity.name || id);
    return Promise.all(versions.map(async version => ({
      name: `${folder}/${this.archiveName(version.version)}.yaml`,
      content: await this.readYaml(version.yaml),
    })));
  }

  private archiveName(value: string) {
    const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
    return safe || 'pricing';
  }

  async resolve(kind: string, id: string, user?: any, authType?: string, requestedVersion?: unknown) {
    if (!mongoose.isObjectIdOrHexString(id)) throw new Error('NOT FOUND');
    if (kind === 'pricing') {
      const identity = await Identity.findOne({ _id: id, deleted: false }).lean();
      if (!identity || !await Pricing.exists({ pricingId: id })) throw new Error('NOT FOUND');
      const collection = identity._collectionId ? await Collection.findById(identity._collectionId).lean() : null;
      if (!await Pricing.exists({ pricingId: id, private: false })) {
        await this.authorize(user, String(identity._organizationId), 'pricing', identity.slug, collection?.slug, authType);
      }
      const versionId = await this.requestedVersionId(identity, requestedVersion, user, authType);
      const query = [
        ...(collection ? [`collection=${encodeURIComponent(collection.slug)}`] : []),
        ...(versionId ? [`version=${versionId}`] : []),
      ];
      return { location: `/pricings/${identity._organizationId}/${encodeURIComponent(identity.slug)}${query.length ? `?${query.join('&')}` : ''}` };
    }
    if (kind === 'collection') {
      const collection = await Collection.findById(id).lean();
      if (!collection) throw new Error('NOT FOUND');
      if (collection.private) await this.authorize(user, String(collection._organizationId), 'collection', collection.slug, undefined, authType);
      return { location: `/collections/${collection._organizationId}/${encodeURIComponent(collection.slug)}` };
    }
    throw new Error('NOT FOUND');
  }

  private async authorize(user: any, organizationId: string, entityType: 'pricing' | 'collection', slug: string, collectionSlug?: string, authType?: string) {
    if (!user) throw new Error('NOT FOUND');
    const { default: container } = await import('../config/container');
    const permissions = container.resolve('permissionService');
    let role = await permissions.resolveOrgRole(user.id, organizationId);
    if (authType === 'api-key') {
      const organization = await container.resolve('organizationRepository').findById(organizationId);
      const scope = user.apiKey?.scopes?.find((entry: any) => String(entry.organizationId) === organizationId ||
        (entry.scope === 'ALL' && organization?.ancestors?.some((id: any) => String(id) === String(entry.organizationId))));
      if (!scope) throw new Error('NOT FOUND');
      if (scope.scope === 'VIEW') role = 'MEMBER';
      else if (scope.scope === 'MANAGEMENT' && role === 'OWNER') role = 'ADMIN';
    }
    const ctx = await permissions.buildBatchContext(user.id, organizationId, role, user.role === 'ADMIN');
    const result = new PermissionEngine().evaluate({ userId: user.id, organizationId,
      entityType, entitySlug: slug, action: 'GET', isPrivate: true, userOrgRole: role,
      isGlobalAdmin: user.role === 'ADMIN' && authType !== 'api-key', collectionSlug,
      collectionPermissions: collectionSlug ? ctx.entityPermissions.get(`collection:${collectionSlug}`) : undefined, entityPermissions: ctx.entityPermissions.get(`${entityType}:${slug}`) });
    if (!result.allowed) throw new Error('NOT FOUND');
  }
}
