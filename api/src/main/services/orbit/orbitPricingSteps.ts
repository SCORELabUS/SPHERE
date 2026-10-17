import { retrievePricingFromText } from 'pricing4ts/server';
import container from '../../config/container';
import PricingRepository from '../../repositories/mongoose/PricingRepository';
import PricingCollectionRepository from '../../repositories/mongoose/PricingCollectionRepository';
import PermissionService from '../PermissionService';
import PricingService from '../PricingService';
import { PermissionEngine } from '../../policies/PermissionEngine';
import { generateSlug } from '../../utils/slug-manager';
import { generateSlug as generateCollectionSlug } from '../../repositories/mongoose/models/PricingCollectionMongoose';
import { EntityType, PermissionType } from '../../types/models/EntityPermission';
import { OrbitAttachment, OrbitOperation, OrbitPlanDraft, OrbitVisibilityChange } from '../../types/models/Orbit';
import { type BuildContext, labelOf, matchResource } from './OrbitPlanService';
import { requesterOf } from './orbitPricingTools';

/** Limits on the pricing changes of one plan, added with phase three. */
export const ORBIT_PRICING_LIMITS = {
  publications: 10,
  visibilityChanges: 200,
  forks: 20,
  newCollections: 20,
  collectionPricingChanges: 500,
  collectionNameLength: 255,
};

type PricingSummary = { slug: string; name: string; private: boolean; collectionId: string | null; versions: number };
type CollectionSummary = { id: string; slug: string; name: string; private: boolean };
type Ref = { slug: string; label: string };

/**
 * Builds the pricing and collection steps of a plan. Like the rest of the plan,
 * whatever the model sent is checked by code: the pricings and collections
 * exist, the files are valid pricings, and the user holds the permission each
 * change needs, worked out with the same policy engine the API uses. Every
 * change targets something that already exists, never something the same plan
 * creates.
 */
export class PricingStepBuilder {
  private pricings = new Map<string, PricingSummary[]>();
  private collections = new Map<string, CollectionSummary[]>();
  private batches = new Map<string, any>();
  private engine = new PermissionEngine();

  constructor(
    private context: BuildContext,
    private attachments: OrbitAttachment[]
  ) {}

  private get pricingRepository(): PricingRepository {
    return container.resolve('pricingRepository');
  }

  private get collectionRepository(): PricingCollectionRepository {
    return container.resolve('pricingCollectionRepository');
  }

  async publications(items: NonNullable<OrbitPlanDraft['pricingPublications']>, errors: string[], warnings: string[]): Promise<OrbitOperation[]> {
    const operations: OrbitOperation[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const organization = await this.organization(item?.organizationId, 'publish pricings in', errors);
      if (!organization) continue;
      const attachment = this.attachments.find(candidate => candidate.id === item?.attachmentId);
      if (!attachment) {
        errors.push(`There is no attachment "${item?.attachmentId}" in this conversation to publish.`);
        continue;
      }

      let parsed: any;
      try {
        parsed = retrievePricingFromText(attachment.content);
      } catch (err: any) {
        errors.push(`"${attachment.filename}" is not a valid pricing: ${String(err?.message ?? err).slice(0, 300)}`);
        continue;
      }
      const version = String(parsed?.version ?? '').trim();
      const saasName = String(parsed?.saasName ?? '').trim();
      if (!version || !saasName) {
        errors.push(`"${attachment.filename}" needs both saasName and version to be published.`);
        continue;
      }

      const requestedName = typeof item?.name === 'string' ? item.name.trim() : '';
      if (requestedName.length > 255) {
        errors.push(`The name for "${attachment.filename}" is longer than 255 characters.`);
        continue;
      }
      const pricingName = requestedName || saasName;

      let collection: { id: string; slug: string; label: string } | null = null;
      if (typeof item?.collection === 'string' && item.collection.trim()) {
        const found = matchResource(await this.collectionsOf(organization.id), item.collection);
        if (!found) {
          errors.push(`"${organization.label}" has no collection called "${item.collection}".`);
          continue;
        }
        collection = { id: found.id, slug: found.slug, label: found.name };
      }

      // The same lookup the publishing service makes: by slug, within the collection if one is named.
      const existing: any = await this.pricingRepository.findOne(generateSlug(pricingName), organization.id, {
        includePrivate: true,
        ...(collection ? { collectionId: collection.id } : {}),
      });
      const addsVersion = !!existing?.versions?.length;
      if (addsVersion && existing.versions.some((stored: any) => String(stored.version) === version)) {
        errors.push(`"${existing.name}" already has a version ${version} in "${organization.label}". Change the version in the file before publishing it.`);
        continue;
      }
      const key = `${organization.id}:${generateSlug(pricingName)}:${version}`;
      if (seen.has(key)) {
        errors.push(`Version ${version} of "${pricingName}" is published twice in this plan.`);
        continue;
      }
      seen.add(key);

      const permitted = addsVersion
        ? await this.allowed(organization.id, 'pricing', 'CREATE', existing.slug, existing.versions[0]?.private === true)
        : await this.allowed(organization.id, 'pricing', 'CREATE');
      if (!permitted) {
        errors.push(
          addsVersion
            ? `You cannot add versions to "${existing.name}" in "${organization.label}".`
            : `You cannot create pricings in "${organization.label}".`
        );
        continue;
      }

      const isPrivate = item?.private === true;
      if (addsVersion) warnings.push(`"${attachment.filename}" becomes version ${version} of the existing pricing "${existing.name}".`);
      operations.push({
        type: 'publish_pricing',
        organization,
        attachment: { id: attachment.id, filename: attachment.filename },
        pricingName: addsVersion ? existing.name : pricingName,
        version,
        existing: addsVersion ? { slug: existing.slug } : null,
        private: isPrivate,
        collection,
      });
    }
    return operations;
  }

  async visibility(items: NonNullable<OrbitPlanDraft['visibilityChanges']>, errors: string[], warnings: string[]): Promise<OrbitOperation[]> {
    const groups = new Map<string, Extract<OrbitOperation, { type: 'set_pricing_visibility' }>>();
    const seen = new Set<string>();
    for (const item of items) {
      const organization = await this.organization(item?.organizationId, 'change the visibility of pricings in', errors);
      if (!organization) continue;
      if (typeof item?.private !== 'boolean') {
        errors.push(`Say whether "${item?.pricing}" becomes private (true) or public (false).`);
        continue;
      }
      const summary = await this.pricing(organization, item?.pricing, errors);
      if (!summary) continue;

      const stored: any = await this.pricingRepository.findOne(summary.slug, organization.id, { includePrivate: true });
      const versions: any[] = stored?.versions ?? [];
      const wanted = typeof item?.version === 'string' && item.version.trim() ? item.version.trim() : null;
      const target = wanted ? versions.find(version => String(version.version).toLowerCase() === wanted.toLowerCase()) : null;
      if (wanted && !target) {
        errors.push(`"${summary.name}" has no version "${wanted}".`);
        continue;
      }

      const key = `${organization.id}:${summary.slug}:${target?.version ?? '*'}`;
      if (seen.has(key)) {
        errors.push(`The visibility of "${summary.name}"${target ? ` ${target.version}` : ''} is set twice; keep one.`);
        continue;
      }
      seen.add(key);

      const affected = target ? [target] : versions;
      const label = target ? `${summary.name} ${target.version}` : `"${summary.name}"`;
      if (affected.every(version => (version.private === true) === item.private)) {
        warnings.push(`${label} is already ${item.private ? 'private' : 'public'}; left out.`);
        continue;
      }
      const isPrivate = (target ?? versions[0])?.private === true;
      if (!(await this.allowed(organization.id, 'pricing', 'PUT', summary.slug, isPrivate))) {
        errors.push(`You cannot edit "${summary.name}" in "${organization.label}".`);
        continue;
      }

      const group = groups.get(organization.id) ?? { type: 'set_pricing_visibility' as const, organization, changes: [] as OrbitVisibilityChange[] };
      groups.set(organization.id, group);
      group.changes.push({ slug: summary.slug, label: summary.name, version: target ? String(target.version) : null, private: item.private });
    }
    return [...groups.values()].filter(group => group.changes.length > 0);
  }

  async forks(items: NonNullable<OrbitPlanDraft['forks']>, errors: string[]): Promise<OrbitOperation[]> {
    const operations: OrbitOperation[] = [];
    const pricingService: PricingService = container.resolve('pricingService');
    const names = new Set<string>();
    for (const item of items) {
      const sourceId = typeof item?.sourceOrganizationId === 'string' ? item.sourceOrganizationId.trim() : '';
      const source = await this.context.findOrganization(sourceId);
      if (!source) {
        errors.push(`Organization ${sourceId || '(missing id)'} does not exist.`);
        continue;
      }
      const target = await this.organization(item?.targetOrganizationId, 'fork pricings into', errors);
      if (!target) continue;
      if (target.id === sourceId) {
        errors.push('A pricing cannot be forked into its own organization.');
        continue;
      }

      // Forking takes being able to see the pricing, as in the web app.
      const sourceRef = { id: sourceId, label: labelOf(source) };
      const summary = matchResource(await this.pricingsOf(sourceId), String(item?.pricing ?? ''));
      let visible: any = null;
      if (summary) {
        visible = await pricingService.show(summary.slug, sourceId, requesterOf(this.context.actor)).catch(() => null);
      }
      if (!summary || !visible) {
        errors.push(`There is no pricing called "${item?.pricing}" in "${sourceRef.label}" that you can see.`);
        continue;
      }
      const wanted = typeof item?.version === 'string' && item.version.trim() ? item.version.trim().toLowerCase() : null;
      const version = wanted
        ? visible.versions.find((candidate: any) => String(candidate.version).toLowerCase() === wanted)
        : visible.versions[0];
      if (!version) {
        errors.push(`"${visible.name}" has no version "${item?.version}" that you can see.`);
        continue;
      }

      if (!(await this.allowed(target.id, 'pricing', 'CREATE'))) {
        errors.push(`You cannot create pricings in "${target.label}".`);
        continue;
      }
      const name = (typeof item?.name === 'string' && item.name.trim()) || visible.name;
      const clash = matchResource(await this.pricingsOf(target.id), generateSlug(name));
      if (clash || names.has(`${target.id}:${generateSlug(name)}`)) {
        errors.push(`"${target.label}" already has a pricing called "${clash?.name ?? name}". A fork always creates a new pricing: give it another name.`);
        continue;
      }
      names.add(`${target.id}:${generateSlug(name)}`);

      operations.push({
        type: 'fork_pricing',
        organization: target,
        source: { organizationId: sourceId, organizationLabel: sourceRef.label, slug: summary.slug, label: visible.name, version: String(version.version) },
        name,
      });
    }
    return operations;
  }

  async newCollections(items: NonNullable<OrbitPlanDraft['newCollections']>, errors: string[], warnings: string[]): Promise<OrbitOperation[]> {
    const operations: OrbitOperation[] = [];
    const planned = new Set<string>();
    for (const item of items) {
      const organization = await this.organization(item?.organizationId, 'create collections in', errors);
      if (!organization) continue;
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      if (!name || name.length > ORBIT_PRICING_LIMITS.collectionNameLength) {
        errors.push(`A collection needs a name of 1 to ${ORBIT_PRICING_LIMITS.collectionNameLength} characters.`);
        continue;
      }
      const slug = generateCollectionSlug(name);
      if (!slug) {
        errors.push(`"${name}" needs letters or digits to name a collection.`);
        continue;
      }
      if ((await this.collectionsOf(organization.id)).some(collection => collection.slug === slug) || planned.has(`${organization.id}:${slug}`)) {
        errors.push(`"${organization.label}" already has a collection called "${name}".`);
        continue;
      }
      if (!(await this.allowed(organization.id, 'collection', 'CREATE'))) {
        errors.push(`You cannot create collections in "${organization.label}".`);
        continue;
      }
      planned.add(`${organization.id}:${slug}`);

      const pricings = await this.pricingRefs(organization, item?.pricings ?? [], warnings, async pricing => {
        const current = pricing.collectionId ? (await this.collectionsOf(organization.id)).find(collection => collection.id === pricing.collectionId) : null;
        if (current) warnings.push(`"${pricing.name}" moves out of the collection "${current.name}" into "${name}".`);
        return true;
      });
      operations.push({
        type: 'create_collection',
        organization,
        name,
        description: typeof item?.description === 'string' && item.description.trim() ? item.description.trim().slice(0, 1000) : null,
        private: item?.private === true,
        pricings,
      });
    }
    return operations;
  }

  async collectionChanges(items: NonNullable<OrbitPlanDraft['collectionChanges']>, errors: string[], warnings: string[]): Promise<OrbitOperation[]> {
    const operations: OrbitOperation[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const organization = await this.organization(item?.organizationId, 'change collections in', errors);
      if (!organization) continue;
      const collection = matchResource(await this.collectionsOf(organization.id), String(item?.collection ?? ''));
      if (!collection) {
        errors.push(`"${organization.label}" has no collection called "${item?.collection}".`);
        continue;
      }
      if (seen.has(`${organization.id}:${collection.slug}`)) {
        errors.push(`The collection "${collection.name}" is changed twice; merge both changes into one.`);
        continue;
      }
      seen.add(`${organization.id}:${collection.slug}`);

      const add = await this.pricingRefs(organization, item?.add ?? [], warnings, async pricing => {
        if (pricing.collectionId === collection.id) {
          warnings.push(`"${pricing.name}" is already in "${collection.name}"; left out.`);
          return false;
        }
        const current = pricing.collectionId ? (await this.collectionsOf(organization.id)).find(other => other.id === pricing.collectionId) : null;
        if (current) warnings.push(`"${pricing.name}" moves out of the collection "${current.name}".`);
        return true;
      });
      const remove = await this.pricingRefs(organization, item?.remove ?? [], warnings, async pricing => {
        if (pricing.collectionId !== collection.id) {
          warnings.push(`"${pricing.name}" is not in "${collection.name}"; left out.`);
          return false;
        }
        return true;
      });
      if (add.some(pricing => remove.some(other => other.slug === pricing.slug))) {
        errors.push(`A pricing is both added to and removed from "${collection.name}".`);
        continue;
      }
      if (add.length + remove.length === 0) continue;

      // The same checks the collection endpoints make: editing the collection to
      // add, and editing pricings of the organization to take them out.
      if (add.length && !(await this.allowed(organization.id, 'collection', 'PUT', collection.slug, collection.private))) {
        errors.push(`You cannot edit the collection "${collection.name}".`);
        continue;
      }
      if (remove.length && !(await this.allowed(organization.id, 'pricing', 'PUT'))) {
        errors.push(`Only an OWNER or ADMIN of "${organization.label}" can take pricings out of its collections.`);
        continue;
      }
      operations.push({
        type: 'update_collection_pricings',
        organization,
        collection: { slug: collection.slug, label: collection.name },
        add,
        remove,
      });
    }
    return operations;
  }

  /** An existing organization the user belongs to; what they may do in it is checked per change. */
  private async organization(rawId: unknown, action: string, errors: string[]): Promise<{ id: string; label: string } | null> {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    const organization = await this.context.findOrganization(id);
    if (!organization) {
      errors.push(`Organization ${id || '(missing id)'} does not exist.`);
      return null;
    }
    if (!(await this.context.roleIn(id))) {
      errors.push(`You must belong to "${labelOf(organization)}" to ${action} it.`);
      return null;
    }
    return { id, label: labelOf(organization) };
  }

  private async pricing(organization: { id: string; label: string }, raw: unknown, errors: string[]): Promise<PricingSummary | null> {
    const found = matchResource(await this.pricingsOf(organization.id), String(raw ?? ''));
    if (!found) errors.push(`"${organization.label}" has no pricing called "${raw}". Check the names with search_pricings.`);
    return found;
  }

  /** Pricings named for a collection, unknown ones left out with a warning. */
  private async pricingRefs(
    organization: { id: string; label: string },
    names: unknown[],
    warnings: string[],
    keep: (pricing: PricingSummary) => Promise<boolean>
  ): Promise<Ref[]> {
    const refs: Ref[] = [];
    for (const raw of Array.isArray(names) ? names : []) {
      const pricing = matchResource(await this.pricingsOf(organization.id), String(raw ?? ''));
      if (!pricing) {
        warnings.push(`"${organization.label}" has no pricing called "${raw}"; left out.`);
        continue;
      }
      if (refs.some(ref => ref.slug === pricing.slug)) continue;
      if (await keep(pricing)) refs.push({ slug: pricing.slug, label: pricing.name });
    }
    return refs;
  }

  private async pricingsOf(organizationId: string): Promise<PricingSummary[]> {
    if (!this.pricings.has(organizationId)) {
      this.pricings.set(organizationId, await this.pricingRepository.findSummariesByOrganization(organizationId));
    }
    return this.pricings.get(organizationId)!;
  }

  private async collectionsOf(organizationId: string): Promise<CollectionSummary[]> {
    if (!this.collections.has(organizationId)) {
      this.collections.set(organizationId, await this.collectionRepository.findSummariesByOrganization(organizationId));
    }
    return this.collections.get(organizationId)!;
  }

  /** Whether the user may do this, by the policies the API applies to the same request. */
  private async allowed(
    organizationId: string,
    entityType: EntityType,
    action: PermissionType,
    entitySlug?: string,
    isPrivate = false
  ): Promise<boolean> {
    const { actor } = this.context;
    const role = await this.context.roleIn(organizationId);
    if (!this.batches.has(organizationId)) {
      const permissionService: PermissionService = container.resolve('permissionService');
      this.batches.set(organizationId, await permissionService.buildBatchContext(actor.id, organizationId, role, actor.role === 'ADMIN'));
    }
    const batch = this.batches.get(organizationId);
    return this.engine.evaluate({
      userId: actor.id,
      organizationId,
      entityType,
      entitySlug,
      action,
      isPrivate,
      userOrgRole: role,
      isGlobalAdmin: actor.role === 'ADMIN',
      orgPermissions: batch.orgPermissions.get(entityType),
      entityPermissions: entitySlug ? batch.entityPermissions.get(`${entityType}:${entitySlug}`) : undefined,
    }).allowed;
  }
}
