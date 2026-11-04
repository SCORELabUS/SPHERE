import container from '../../config/container';
import OrganizationMembershipRepository from '../../repositories/mongoose/OrganizationMembershipRepository';
import PricingFollowRepository from '../../repositories/mongoose/PricingFollowRepository';
import PricingRepository from '../../repositories/mongoose/PricingRepository';
import { OrbitOperation, OrbitPlanDraft } from '../../types/models/Orbit';
import { type BuildContext, labelOf, plural } from './OrbitPlanService';
import { type PricingStepBuilder, type PricingSummary } from './orbitPricingSteps';

/** Limits on the deletions of one plan, added with phase five. */
export const ORBIT_DELETION_LIMITS = {
  deletions: 20,
  /** Organizations one deletion can take with it, counting the one named. */
  organizationsPerDeletion: 50,
};

type Organization = { id: string; label: string };

/**
 * Validates the deletions of a plan and works out everything each one takes
 * with it, so the card shows it before anything is gone: the sub-organizations
 * of an organization with their pricings, collections, members and invitations;
 * the versions and followers of a pricing; the pricings of a collection.
 *
 * What goes away with something else that is deleted in the same plan is left
 * out, so nothing is deleted twice. Permissions are those of the API, and
 * deleting an organization takes being its OWNER.
 */
export class DeletionStepBuilder {
  /** Organizations that go, named or below one named. */
  private deletedOrganizations = new Set<string>();
  /** Pricings that go with a collection, as organizationId:slug. */
  private deletedPricings = new Set<string>();

  constructor(
    private context: BuildContext,
    private pricingSteps: PricingStepBuilder
  ) {}

  async organizations(
    items: NonNullable<OrbitPlanDraft['organizationDeletions']>,
    errors: string[],
    warnings: string[]
  ): Promise<OrbitOperation[]> {
    const operations: OrbitOperation[] = [];
    const memberships: OrganizationMembershipRepository = container.resolve('organizationMembershipRepository');

    const named: Array<{ id: string; organization: any }> = [];
    for (const item of items) {
      const id = typeof item?.organizationId === 'string' ? item.organizationId.trim() : '';
      const organization = await this.context.findOrganization(id);
      if (!organization) {
        errors.push(`Organization ${id || '(missing id)'} does not exist.`);
        continue;
      }
      if (!named.some(entry => entry.id === id)) named.push({ id, organization });
    }
    // One below another that is named goes with it.
    const below = new Set<string>();
    for (const { id } of named) (await this.context.descendantsOf(id)).forEach(descendant => below.add(descendant.id));

    for (const { id, organization } of named) {
      const label = labelOf(organization);
      if (below.has(id)) {
        warnings.push(`"${label}" goes with an organization above it that is deleted too; left out.`);
        continue;
      }
      if (organization.isPersonal) {
        errors.push(`"${label}" is a personal organization, and those cannot be deleted.`);
        continue;
      }
      if ((await this.context.directRoleOf(this.context.actor.id, id)) !== 'OWNER') {
        errors.push(`Only the OWNER of "${label}" can delete it.`);
        continue;
      }

      const descendants = await this.context.descendantsOf(id);
      if (descendants.length + 1 > ORBIT_DELETION_LIMITS.organizationsPerDeletion) {
        errors.push(
          `"${label}" has ${descendants.length} sub-organizations; one deletion can take at most ${ORBIT_DELETION_LIMITS.organizationsPerDeletion - 1}. Delete some of its branches first.`
        );
        continue;
      }

      const subOrganizations: Organization[] = [];
      let pricings = 0;
      let collections = 0;
      let invitations = 0;
      const members = new Set<string>();
      for (const organizationId of [id, ...descendants.map(descendant => descendant.id)]) {
        const current = await this.context.findOrganization(organizationId);
        if (organizationId !== id) {
          subOrganizations.push({ id: organizationId, label: labelOf(current) });
          if (current?.isPersonal) errors.push(`"${labelOf(current)}", below "${label}", is a personal organization and cannot be deleted.`);
        }
        pricings += (await this.pricingSteps.pricingsOf(organizationId)).length;
        collections += (await this.pricingSteps.allCollectionsOf(organizationId)).length;
        invitations += (await this.context.invitationsOf(organizationId)).length;
        for (const member of await memberships.findByOrganizationId(organizationId)) {
          if (member._userId !== this.context.actor.id) members.add(member._userId);
          if (organizationId !== id && member.role === 'OWNER' && member._userId !== this.context.actor.id) {
            warnings.push(`"${labelOf(current)}" belongs to @${member.user?.username ?? 'another user'} and is deleted with "${label}".`);
          }
        }
      }

      this.deletedOrganizations.add(id);
      descendants.forEach(descendant => this.deletedOrganizations.add(descendant.id));
      operations.push({
        type: 'delete_organization',
        organization: { id, label },
        subOrganizations,
        pricings,
        collections,
        members: members.size,
        invitations,
      });
    }
    return operations;
  }

  async collections(
    items: NonNullable<OrbitPlanDraft['collectionDeletions']>,
    errors: string[],
    warnings: string[]
  ): Promise<OrbitOperation[]> {
    const operations: OrbitOperation[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const organization = await this.pricingSteps.organization(item?.organizationId, 'delete collections in', errors);
      if (!organization) continue;
      const collection = (await this.pricingSteps.collectionsOf(organization.id)).find(
        entry => entry.slug === String(item?.collection ?? '').trim() ||
          entry.name.trim().toLowerCase() === String(item?.collection ?? '').trim().toLowerCase()
      );
      if (!collection) {
        errors.push(`"${organization.label}" has no collection called "${item?.collection}".`);
        continue;
      }
      if (this.deletedOrganizations.has(organization.id)) {
        warnings.push(`The collection "${collection.name}" goes with "${organization.label}", which is deleted too; left out.`);
        continue;
      }
      if (seen.has(`${organization.id}:${collection.slug}`)) continue;
      seen.add(`${organization.id}:${collection.slug}`);
      if (!(await this.pricingSteps.allowed(organization.id, 'collection', 'DELETE', collection.slug, collection.private))) {
        errors.push(`You are not allowed to delete the collection "${collection.name}" in "${organization.label}".`);
        continue;
      }

      const withPricings = item?.withPricings === true;
      const inside = (await this.pricingSteps.pricingsOf(organization.id)).filter(pricing => pricing.collectionId === collection.id);
      if (withPricings) {
        const forbidden: string[] = [];
        for (const pricing of inside) {
          if (!(await this.pricingSteps.allowed(organization.id, 'pricing', 'DELETE', pricing.slug, pricing.private))) forbidden.push(pricing.name);
        }
        if (forbidden.length) {
          errors.push(`Deleting "${collection.name}" with its pricings takes being allowed to delete each of them, and you cannot delete ${forbidden.map(name => `"${name}"`).join(', ')}.`);
          continue;
        }
        inside.forEach(pricing => this.deletedPricings.add(`${organization.id}:${pricing.slug}`));
      }
      operations.push({
        type: 'delete_collection',
        organization,
        collection: { slug: collection.slug, label: collection.name },
        withPricings,
        pricings: inside.map(pricing => ({ slug: pricing.slug, label: pricing.name })),
      });
    }
    return operations;
  }

  async pricings(
    items: NonNullable<OrbitPlanDraft['pricingDeletions']>,
    errors: string[],
    warnings: string[]
  ): Promise<OrbitOperation[]> {
    // Whole pricings and versions of the same pricing are merged first.
    const wanted = new Map<string, { organization: Organization; pricing: PricingSummary; versions: Set<string> | null }>();
    for (const item of items) {
      const organization = await this.pricingSteps.organization(item?.organizationId, 'delete pricings in', errors);
      if (!organization) continue;
      const pricing = await this.pricingSteps.pricing(organization, item?.pricing, errors);
      if (!pricing) continue;
      if (this.deletedOrganizations.has(organization.id)) {
        warnings.push(`"${pricing.name}" goes with "${organization.label}", which is deleted too; left out.`);
        continue;
      }
      if (this.deletedPricings.has(`${organization.id}:${pricing.slug}`)) {
        warnings.push(`"${pricing.name}" goes with its collection, which is deleted with its pricings; left out.`);
        continue;
      }
      const key = `${organization.id}:${pricing.slug}`;
      const versions = Array.isArray(item?.versions) && item.versions.length ? item.versions.map(version => String(version).trim()) : null;
      const entry = wanted.get(key);
      if (!entry) wanted.set(key, { organization, pricing, versions: versions ? new Set(versions) : null });
      else if (!versions) entry.versions = null;
      else if (entry.versions) versions.forEach(version => entry.versions!.add(version));
    }

    const pricingRepository: PricingRepository = container.resolve('pricingRepository');
    const follows: PricingFollowRepository = container.resolve('pricingFollowRepository');
    const operations: OrbitOperation[] = [];
    for (const { organization, pricing, versions } of wanted.values()) {
      if (!(await this.pricingSteps.allowed(organization.id, 'pricing', 'DELETE', pricing.slug, pricing.private))) {
        errors.push(`You are not allowed to delete "${pricing.name}" in "${organization.label}".`);
        continue;
      }
      const stored: any = await pricingRepository.findOne(pricing.slug, organization.id, { includePrivate: true });
      const labels: string[] = (stored?.versions ?? []).map((version: any) => String(version.version));
      const ref = { slug: pricing.slug, label: pricing.name };

      let deleteAll = versions === null;
      if (versions) {
        const matched: string[] = [];
        for (const version of versions) {
          const label = labels.find(existing => existing.toLowerCase() === version.toLowerCase());
          if (!label) errors.push(`"${pricing.name}" has no version "${version}". Its versions are ${labels.join(', ')}.`);
          else if (!matched.includes(label)) matched.push(label);
        }
        if (matched.length < versions.size) continue;
        if (matched.length === labels.length) {
          warnings.push(`Those are all the versions of "${pricing.name}", so the whole pricing is deleted.`);
          deleteAll = true;
        } else {
          operations.push({ type: 'delete_pricing_versions', organization, pricing: ref, versions: matched, remaining: labels.length - matched.length });
          continue;
        }
      }
      if (deleteAll) {
        const familyId = await pricingRepository.familyIdOf(pricing.slug, organization.id);
        const collection = pricing.collectionId
          ? (await this.pricingSteps.collectionsOf(organization.id)).find(entry => entry.id === pricing.collectionId)?.name ?? null
          : null;
        operations.push({
          type: 'delete_pricing',
          organization,
          pricing: ref,
          versions: labels.length || pricing.versions,
          followers: familyId ? (await follows.findFollowerIds(familyId)).length : 0,
          collection,
        });
      }
    }
    return operations;
  }
}

/** Deleting things is confirmed by typing what is deleted, or how many things when there are several. */
export function deletionConfirmationPhrase(operations: OrbitOperation[]): string {
  if (operations.length > 1) return `delete ${plural(operations.length, 'item')}`;
  const [operation] = operations;
  switch (operation.type) {
    case 'delete_organization':
      return operation.organization.label;
    case 'delete_collection':
      return operation.collection.label;
    case 'delete_pricing':
    case 'delete_pricing_versions':
      return operation.pricing.label;
    default:
      return 'delete';
  }
}
