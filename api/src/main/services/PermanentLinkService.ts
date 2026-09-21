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

  async resolve(kind: string, id: string, user?: any, authType?: string) {
    if (!mongoose.isObjectIdOrHexString(id)) throw new Error('NOT FOUND');
    if (kind === 'pricing') {
      const identity = await Identity.findOne({ _id: id, deleted: false }).lean();
      if (!identity || !await Pricing.exists({ pricingId: id })) throw new Error('NOT FOUND');
      const collection = identity._collectionId ? await Collection.findById(identity._collectionId).lean() : null;
      if (!await Pricing.exists({ pricingId: id, private: false })) {
        await this.authorize(user, String(identity._organizationId), 'pricing', identity.slug, collection?.slug, authType);
      }
      return { location: `/pricings/${identity._organizationId}/${encodeURIComponent(identity.slug)}${collection ? `?collection=${encodeURIComponent(collection.slug)}` : ''}` };
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
