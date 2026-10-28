import mongoose from 'mongoose';
import container from '../../config/container';
import OrganizationRepository from '../../repositories/mongoose/OrganizationRepository';
import UserRepository from '../../repositories/mongoose/UserRepository';
import OrbitPlanRepository from '../../repositories/mongoose/OrbitPlanRepository';
import OrbitAuditLogRepository from '../../repositories/mongoose/OrbitAuditLogRepository';
import OrganizationMembershipRepository from '../../repositories/mongoose/OrganizationMembershipRepository';
import EntityPermissionRepository from '../../repositories/mongoose/EntityPermissionRepository';
import PricingRepository from '../../repositories/mongoose/PricingRepository';
import PricingCollectionRepository from '../../repositories/mongoose/PricingCollectionRepository';
import OrganizationService from '../OrganizationService';
import { OrgRole } from '../../types/models/Organization';
import { LeanUser } from '../../types/models/User';
import {
  LeanOrbitPlan,
  OrbitAccess,
  OrbitAssignableRole,
  OrbitAttachment,
  OrbitIgnoredRow,
  OrbitOperation,
  OrbitOrgReference,
  OrbitPlanDraft,
  OrbitPlanInvitee,
  OrbitPlanMember,
  OrbitPlanSource,
  OrbitPlanStep,
  OrbitPermissionChange,
  OrbitResourceType,
} from '../../types/models/Orbit';
import { canManage, isRenameAllowed, OrbitActor, resolveOrgRole } from './orbitAccess';
import { ORBIT_PRICING_LIMITS, PricingStepBuilder } from './orbitPricingSteps';
import { AccountStepBuilder } from './orbitAccountSteps';
import { DeletionStepBuilder, deletionConfirmationPhrase, ORBIT_DELETION_LIMITS } from './orbitDeletionSteps';

/**
 * Hard limits on what ORBIT may do, enforced here by code whatever the model
 * proposes. The model is told them too, so it can split the work or ask first.
 */
export const ORBIT_PLAN_LIMITS = {
  organizations: 50,
  /** Direct sub-organizations any organization may end up with, counting the ones it already has. */
  childrenPerOrganization: 50,
  /** Levels from the top of the tree down to the deepest organization, existing ancestors included. */
  depth: 6,
  /** Organizations one user may create through ORBIT in a rolling day. */
  organizationsPerDay: 300,
  updates: 50,
  members: 1000,
  invitees: 500,
  invitationLinks: 50,
  displayNameLength: 255,
  descriptionLength: 1000,
  roleChanges: 500,
  removals: 500,
  invitationRevocations: 100,
  moves: 20,
  permissionChanges: 500,
};

const ACCESS_ORDER: OrbitAccess[] = ['GET', 'PUT', 'DELETE', 'CREATE'];

const DEFAULT_LINK_EXPIRY_DAYS = 7;
const MAX_LINK_EXPIRY_DAYS = 365;
const MAX_LINK_USES = 10_000;

export type OrbitPlanBuildResult =
  | { ok: true; summary: string; steps: OrbitPlanStep[]; warnings: string[]; confirmationPhrase: string | null }
  | { ok: false; errors: string[]; warnings: string[] };

export type OrbitProposeResult =
  | { ok: true; plan: LeanOrbitPlan }
  | { ok: false; errors: string[]; warnings: string[] };

type DraftOrganization = NonNullable<OrbitPlanDraft['organizations']>[number];

/**
 * Turns a proposal into a plan the executor can apply without thinking.
 *
 * Whatever the model or the file importer sent is checked here by code: every
 * organization exists and the user manages it, the new tree has no cycles and
 * no missing parents, every user is resolved to a real account, and the limits
 * hold. Problems that make the plan meaningless come back as errors, for the
 * model to fix or explain; items that can simply be left out (an unknown user,
 * someone already in the organization) are dropped with a warning the user
 * sees before confirming.
 */
class OrbitPlanService {
  private organizationRepository: OrganizationRepository;
  private organizationService: OrganizationService;
  private userRepository: UserRepository;
  private orbitPlanRepository: OrbitPlanRepository;
  private orbitAuditLogRepository: OrbitAuditLogRepository;
  private organizationMembershipRepository: OrganizationMembershipRepository;
  private pricingRepository: PricingRepository;
  private pricingCollectionRepository: PricingCollectionRepository;

  constructor() {
    this.organizationRepository = container.resolve('organizationRepository');
    this.organizationService = container.resolve('organizationService');
    this.userRepository = container.resolve('userRepository');
    this.orbitPlanRepository = container.resolve('orbitPlanRepository');
    this.orbitAuditLogRepository = container.resolve('orbitAuditLogRepository');
    this.organizationMembershipRepository = container.resolve('organizationMembershipRepository');
    this.pricingRepository = container.resolve('pricingRepository');
    this.pricingCollectionRepository = container.resolve('pricingCollectionRepository');
  }

  /** How many more organizations the user may create through ORBIT today. */
  async remainingOrganizationsToday(actor: OrbitActor): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const created = await this.orbitAuditLogRepository.countSuccessfulSince(actor.id, 'create_organization', since);
    return Math.max(0, ORBIT_PLAN_LIMITS.organizationsPerDay - created);
  }

  /**
   * Checked again when a plan is confirmed: other plans may have used up the
   * day's allowance since this one was proposed.
   */
  async assertDailyAllowance(actor: OrbitActor, plan: LeanOrbitPlan): Promise<void> {
    const creates = plan.steps.filter(step => step.operation.type === 'create_organization').length;
    if (creates === 0) return;
    const remaining = await this.remainingOrganizationsToday(actor);
    if (creates > remaining) {
      throw new Error(
        `TOO MANY REQUESTS: This plan creates ${creates} organizations, but you can only create ${remaining} more with ORBIT in the next 24 hours (limit ${ORBIT_PLAN_LIMITS.organizationsPerDay} a day)`
      );
    }
  }

  /** Builds the plan and, when it holds, stores it as the conversation's pending one. */
  async propose(
    actor: OrbitActor,
    conversationId: string,
    draft: OrbitPlanDraft,
    options: {
      source?: OrbitPlanSource;
      /** The API key an assistant proposes it with through MCP. */
      apiKeyId?: string | null;
      credentialId?: string | null;
      ignoredRows?: OrbitIgnoredRow[];
      warnings?: string[];
      /** The conversation's files, for pricings published from one of them. */
      attachments?: OrbitAttachment[];
    } = {}
  ): Promise<OrbitProposeResult> {
    const built = await this.build(actor, draft, options.warnings ?? [], options.attachments ?? []);
    if (!built.ok) return built;

    await this.orbitPlanRepository.supersedePending(conversationId);
    const plan = await this.orbitPlanRepository.create({
      userId: actor.id,
      conversationId,
      summary: built.summary,
      source: options.source ?? 'chat',
      apiKeyId: options.apiKeyId ?? null,
      credentialId: options.credentialId ?? null,
      steps: built.steps,
      warnings: built.warnings,
      ignoredRows: options.ignoredRows ?? [],
      confirmationPhrase: built.confirmationPhrase,
    });
    return { ok: true, plan };
  }

  async build(
    actor: OrbitActor,
    draft: OrbitPlanDraft,
    initialWarnings: string[] = [],
    attachments: OrbitAttachment[] = []
  ): Promise<OrbitPlanBuildResult> {
    const context = new BuildContext(actor, {
      organizationRepository: this.organizationRepository,
      organizationService: this.organizationService,
      userRepository: this.userRepository,
      organizationMembershipRepository: this.organizationMembershipRepository,
      pricingRepository: this.pricingRepository,
      pricingCollectionRepository: this.pricingCollectionRepository,
    });
    const errors: string[] = [];
    const warnings: string[] = [...initialWarnings];

    const organizations = asArray(draft.organizations);
    const updates = asArray(draft.updates);
    const members = asArray(draft.members);
    const invitations = asArray(draft.invitations);
    const links = asArray(draft.invitationLinks);
    const roleChanges = asArray(draft.roleChanges);
    const removals = asArray(draft.removals);
    const revocations = asArray(draft.invitationRevocations);
    const moves = asArray(draft.moves);
    const permissions = asArray(draft.permissions);
    const transfer = draft.ownershipTransfer ?? null;
    const publications = asArray(draft.pricingPublications);
    const visibilityChanges = asArray(draft.visibilityChanges);
    const forks = asArray(draft.forks);
    const newCollections = asArray(draft.newCollections);
    const collectionChanges = asArray(draft.collectionChanges);
    const notificationPreferences = asArray(draft.notificationPreferences);
    const accountChanges = (draft.notificationsRead ? 1 : 0) + notificationPreferences.length + (draft.profile ? 1 : 0);
    const organizationDeletions = asArray(draft.organizationDeletions);
    const pricingDeletions = asArray(draft.pricingDeletions);
    const collectionDeletions = asArray(draft.collectionDeletions);
    const deletions = organizationDeletions.length + pricingDeletions.length + collectionDeletions.length;
    const collectionPricingChanges = collectionChanges.reduce(
      (total, change) => total + asArray(change?.add).length + asArray(change?.remove).length,
      0
    );

    const inviteeCount = invitations.reduce((total, invitation) => total + asArray(invitation?.users).length, 0);
    if (organizations.length > ORBIT_PLAN_LIMITS.organizations) {
      errors.push(`A plan can create at most ${ORBIT_PLAN_LIMITS.organizations} organizations (got ${organizations.length}). Split it into smaller plans.`);
    }
    if (updates.length > ORBIT_PLAN_LIMITS.updates) {
      errors.push(`A plan can edit at most ${ORBIT_PLAN_LIMITS.updates} organizations (got ${updates.length}).`);
    }
    if (members.length > ORBIT_PLAN_LIMITS.members) {
      errors.push(`A plan can add at most ${ORBIT_PLAN_LIMITS.members} members (got ${members.length}).`);
    }
    if (inviteeCount > ORBIT_PLAN_LIMITS.invitees) {
      errors.push(`A plan can invite at most ${ORBIT_PLAN_LIMITS.invitees} users (got ${inviteeCount}).`);
    }
    if (links.length > ORBIT_PLAN_LIMITS.invitationLinks) {
      errors.push(`A plan can create at most ${ORBIT_PLAN_LIMITS.invitationLinks} invitation links (got ${links.length}).`);
    }
    if (roleChanges.length > ORBIT_PLAN_LIMITS.roleChanges) {
      errors.push(`A plan can change at most ${ORBIT_PLAN_LIMITS.roleChanges} roles (got ${roleChanges.length}).`);
    }
    if (removals.length > ORBIT_PLAN_LIMITS.removals) {
      errors.push(`A plan can remove at most ${ORBIT_PLAN_LIMITS.removals} members (got ${removals.length}).`);
    }
    if (revocations.length > ORBIT_PLAN_LIMITS.invitationRevocations) {
      errors.push(`A plan can revoke at most ${ORBIT_PLAN_LIMITS.invitationRevocations} invitations (got ${revocations.length}).`);
    }
    if (moves.length > ORBIT_PLAN_LIMITS.moves) {
      errors.push(`A plan can move at most ${ORBIT_PLAN_LIMITS.moves} organizations (got ${moves.length}).`);
    }
    if (permissions.length > ORBIT_PLAN_LIMITS.permissionChanges) {
      errors.push(`A plan can change at most ${ORBIT_PLAN_LIMITS.permissionChanges} permissions (got ${permissions.length}).`);
    }
    if (publications.length > ORBIT_PRICING_LIMITS.publications) {
      errors.push(`A plan can publish at most ${ORBIT_PRICING_LIMITS.publications} pricing files (got ${publications.length}).`);
    }
    if (visibilityChanges.length > ORBIT_PRICING_LIMITS.visibilityChanges) {
      errors.push(`A plan can change the visibility of at most ${ORBIT_PRICING_LIMITS.visibilityChanges} pricings or versions (got ${visibilityChanges.length}).`);
    }
    if (forks.length > ORBIT_PRICING_LIMITS.forks) {
      errors.push(`A plan can fork at most ${ORBIT_PRICING_LIMITS.forks} pricings (got ${forks.length}).`);
    }
    if (newCollections.length > ORBIT_PRICING_LIMITS.newCollections) {
      errors.push(`A plan can create at most ${ORBIT_PRICING_LIMITS.newCollections} collections (got ${newCollections.length}).`);
    }
    if (collectionPricingChanges > ORBIT_PRICING_LIMITS.collectionPricingChanges) {
      errors.push(`A plan can add or remove at most ${ORBIT_PRICING_LIMITS.collectionPricingChanges} pricings in collections (got ${collectionPricingChanges}).`);
    }
    if (deletions > ORBIT_DELETION_LIMITS.deletions) {
      errors.push(`A plan can delete at most ${ORBIT_DELETION_LIMITS.deletions} things (got ${deletions}).`);
    }
    if (errors.length > 0) return { ok: false, errors, warnings };

    // Deleting cannot be undone, so it is never mixed with anything else and is
    // confirmed by typing what goes.
    if (deletions > 0) {
      const others = organizations.length + updates.length + members.length + invitations.length + links.length +
        roleChanges.length + removals.length + revocations.length + moves.length + permissions.length +
        publications.length + visibilityChanges.length + forks.length + newCollections.length + collectionChanges.length +
        accountChanges + (transfer ? 1 : 0);
      if (others > 0) {
        return {
          ok: false,
          errors: ['Deletions go in a plan of their own: propose the other changes in a separate plan.'],
          warnings,
        };
      }
      const deletionSteps = new DeletionStepBuilder(context, new PricingStepBuilder(context, attachments));
      const organizationSteps = await deletionSteps.organizations(organizationDeletions, errors, warnings);
      const collectionSteps = await deletionSteps.collections(collectionDeletions, errors, warnings);
      const pricingSteps = await deletionSteps.pricings(pricingDeletions, errors, warnings);
      if (errors.length > 0) return { ok: false, errors: unique(errors), warnings: unique(warnings) };
      // Smallest first: an organization goes last, once what was named inside others is gone.
      const operations = [...pricingSteps, ...collectionSteps, ...organizationSteps];
      if (operations.length === 0) {
        return { ok: false, errors: ['The plan has nothing left to delete once the items above are left out.'], warnings: unique(warnings) };
      }
      const steps: OrbitPlanStep[] = operations.map((operation, index) => ({
        id: `s${index + 1}`,
        description: describeOperation(operation),
        operation,
        status: 'PENDING',
        result: null,
        error: null,
      }));
      return {
        ok: true,
        summary: typeof draft.summary === 'string' && draft.summary.trim() ? draft.summary.trim().slice(0, 500) : summarizeSteps(steps),
        steps,
        warnings: unique(warnings),
        confirmationPhrase: deletionConfirmationPhrase(operations),
      };
    }

    // Handing an organization over cannot be undone by the one who gave it away,
    // so it is never mixed with anything else and is confirmed by typing its name.
    if (transfer) {
      const others = organizations.length + updates.length + members.length + invitations.length + links.length +
        roleChanges.length + removals.length + revocations.length + moves.length + permissions.length +
        publications.length + visibilityChanges.length + forks.length + newCollections.length + collectionChanges.length +
        accountChanges + deletions;
      if (others > 0) {
        return {
          ok: false,
          errors: ['Handing an organization over goes in a plan of its own: propose the other changes in a separate plan.'],
          warnings,
        };
      }
      const operation = await this.buildOwnershipTransfer(context, transfer, errors, warnings);
      if (!operation || errors.length > 0) return { ok: false, errors: unique(errors), warnings: unique(warnings) };
      const step: OrbitPlanStep = {
        id: 's1',
        description: describeOperation(operation),
        operation,
        status: 'PENDING',
        result: null,
        error: null,
      };
      return {
        ok: true,
        summary: typeof draft.summary === 'string' && draft.summary.trim() ? draft.summary.trim().slice(0, 500) : step.description,
        steps: [step],
        warnings: unique(warnings),
        confirmationPhrase: operation.organization.label,
      };
    }

    const createSteps = await this.buildCreateSteps(context, organizations, errors);
    if (createSteps.length > 0) {
      const remaining = await this.remainingOrganizationsToday(actor);
      if (createSteps.length > remaining) {
        errors.push(
          `You can create ${remaining} more organization${remaining === 1 ? '' : 's'} with ORBIT in the next 24 hours (limit ${ORBIT_PLAN_LIMITS.organizationsPerDay} a day), and this plan creates ${createSteps.length}.`
        );
      }
    }
    const updateSteps = await this.buildUpdateSteps(context, updates, errors);
    const memberSteps = await this.buildMemberSteps(context, members, errors, warnings);
    const inviteSteps = await this.buildInvitationSteps(context, invitations, errors, warnings);
    const linkSteps = await this.buildLinkSteps(context, links, errors);
    const roleSteps = await this.buildRoleChangeSteps(context, roleChanges, errors, warnings);
    const permissionSteps = await this.buildPermissionSteps(context, permissions, errors, warnings);
    const removalSteps = await this.buildRemovalSteps(context, removals, errors, warnings);
    const revocationSteps = await this.buildRevocationSteps(context, revocations, errors);
    const moveSteps = await this.buildMoveSteps(context, moves, errors, warnings);
    checkRemovalConflicts(roleSteps, permissionSteps, removalSteps, errors);
    const pricingSteps = new PricingStepBuilder(context, attachments);
    const publicationSteps = await pricingSteps.publications(publications, errors, warnings);
    const forkSteps = await pricingSteps.forks(forks, errors);
    const newCollectionSteps = await pricingSteps.newCollections(newCollections, errors, warnings);
    const collectionSteps = await pricingSteps.collectionChanges(collectionChanges, errors, warnings);
    const visibilitySteps = await pricingSteps.visibility(visibilityChanges, errors, warnings);
    const accountSteps = new AccountStepBuilder(actor);
    const profileSteps = await accountSteps.profile(draft.profile, errors, warnings);
    const preferenceSteps = await accountSteps.notificationPreferences(notificationPreferences, errors, warnings);
    const readSteps = await accountSteps.notificationsRead(draft.notificationsRead, errors, warnings);

    if (errors.length > 0) return { ok: false, errors: unique(errors), warnings: unique(warnings) };

    // Who is in and with which role is settled before the access that depends on
    // it, and the tree is rearranged last, once everything inside it is in place.
    const operations = [
      ...createSteps,
      ...updateSteps,
      ...memberSteps,
      ...roleSteps,
      ...permissionSteps,
      ...removalSteps,
      ...inviteSteps,
      ...linkSteps,
      ...revocationSteps,
      ...moveSteps,
      ...publicationSteps,
      // Before forking, since a fork copies the visibility of what it forks.
      ...visibilitySteps,
      ...forkSteps,
      ...newCollectionSteps,
      ...collectionSteps,
      ...profileSteps,
      ...preferenceSteps,
      ...readSteps,
    ];
    if (operations.length === 0) {
      return {
        ok: false,
        errors: ['The plan has no changes left to make once the items above are left out.'],
        warnings: unique(warnings),
      };
    }

    const steps: OrbitPlanStep[] = operations.map((operation, index) => ({
      id: `s${index + 1}`,
      description: describeOperation(operation),
      operation,
      status: 'PENDING',
      result: null,
      error: null,
    }));

    const summary = typeof draft.summary === 'string' && draft.summary.trim()
      ? draft.summary.trim().slice(0, 500)
      : summarizeSteps(steps);

    return { ok: true, summary, steps, warnings: unique(warnings), confirmationPhrase: null };
  }

  private async buildCreateSteps(
    context: BuildContext,
    organizations: DraftOrganization[],
    errors: string[]
  ): Promise<OrbitOperation[]> {
    const byRef = new Map<string, DraftOrganization>();

    for (const [index, organization] of organizations.entries()) {
      const ref = typeof organization?.ref === 'string' ? organization.ref.trim() : '';
      if (!ref) {
        errors.push(`organizations[${index}] needs a "ref" so other items can point at it.`);
        continue;
      }
      if (byRef.has(ref)) {
        errors.push(`The ref "${ref}" is used by more than one new organization.`);
        continue;
      }
      byRef.set(ref, { ...organization, ref });
    }

    for (const organization of byRef.values()) {
      const displayName = typeof organization.displayName === 'string' ? organization.displayName.trim() : '';
      if (!displayName) {
        errors.push(`The new organization "${organization.ref}" needs a displayName.`);
      } else if (displayName.length > ORBIT_PLAN_LIMITS.displayNameLength) {
        errors.push(`The name of "${organization.ref}" is longer than ${ORBIT_PLAN_LIMITS.displayNameLength} characters.`);
      }
      if (
        typeof organization.description === 'string' &&
        organization.description.length > ORBIT_PLAN_LIMITS.descriptionLength
      ) {
        errors.push(`The description of "${organization.ref}" is longer than ${ORBIT_PLAN_LIMITS.descriptionLength} characters.`);
      }
      if (organization.parentRef && organization.parentId) {
        errors.push(`"${organization.ref}" names both a parentRef and a parentId; give only one.`);
      }
      if (organization.parentRef && !byRef.has(organization.parentRef)) {
        errors.push(`"${organization.ref}" hangs from "${organization.parentRef}", which is not one of the new organizations.`);
      }
    }

    // Parents that already exist must be organizations the user manages: that is
    // what creating children through the API asks for.
    const existingParentIds = unique(
      [...byRef.values()].map(organization => organization.parentId).filter((id): id is string => !!id)
    );
    for (const parentId of existingParentIds) {
      const parent = await context.findOrganization(parentId);
      if (!parent) {
        errors.push(`The parent organization ${parentId} does not exist.`);
        continue;
      }
      if (parent.isPersonal) {
        errors.push(`"${labelOf(parent)}" is a personal organization and cannot have sub-organizations.`);
        continue;
      }
      if (!canManage(await context.roleIn(parentId))) {
        errors.push(`You must be an OWNER or ADMIN of "${labelOf(parent)}" to create organizations under it.`);
      }
    }

    const ordered = orderParentsFirst([...byRef.values()]);
    if (ordered.cycle.length > 0) {
      errors.push(`These new organizations form a cycle and cannot be placed in a tree: ${ordered.cycle.join(', ')}.`);
    }
    if (errors.length > 0) return [];

    await this.checkTreeLimits(context, ordered.items, errors);
    if (errors.length > 0) return [];

    const operations: OrbitOperation[] = [];
    for (const organization of ordered.items) {
      let parent: OrbitOrgReference | null = null;
      if (organization.parentRef) {
        parent = { ref: organization.parentRef, label: byRef.get(organization.parentRef)!.displayName.trim() };
      } else if (organization.parentId) {
        const existing = await context.findOrganization(organization.parentId);
        parent = { id: organization.parentId, label: labelOf(existing) };
      }
      context.planOrganizations.set(organization.ref, organization.displayName.trim());
      operations.push({
        type: 'create_organization',
        ref: organization.ref,
        displayName: organization.displayName.trim(),
        description: typeof organization.description === 'string' && organization.description.trim()
          ? organization.description.trim()
          : null,
        parent,
      });
    }
    return operations;
  }

  /**
   * Keeps the resulting tree within bounds: no organization ends up with more
   * than the allowed number of direct children, and nothing is placed deeper
   * than the allowed number of levels.
   */
  private async checkTreeLimits(context: BuildContext, organizations: DraftOrganization[], errors: string[]) {
    const { childrenPerOrganization, depth: maxDepth } = ORBIT_PLAN_LIMITS;

    const newChildren = new Map<string, { parentId?: string; parentRef?: string; count: number }>();
    for (const organization of organizations) {
      if (!organization.parentRef && !organization.parentId) continue;
      const key = organization.parentRef ? `ref:${organization.parentRef}` : `id:${organization.parentId}`;
      const entry = newChildren.get(key) ?? {
        parentId: organization.parentRef ? undefined : organization.parentId ?? undefined,
        parentRef: organization.parentRef ?? undefined,
        count: 0,
      };
      entry.count++;
      newChildren.set(key, entry);
    }
    for (const { parentId, parentRef, count } of newChildren.values()) {
      let existing = 0;
      let label: string;
      if (parentId) {
        existing = (await this.organizationRepository.findChildOrganizationIds(parentId)).length;
        label = labelOf(await context.findOrganization(parentId));
      } else {
        label = organizations.find(organization => organization.ref === parentRef)?.displayName ?? String(parentRef);
      }
      if (existing + count > childrenPerOrganization) {
        errors.push(
          `"${label}" would end up with ${existing + count} sub-organizations${existing ? ` (${existing} already exist)` : ''}; an organization can have at most ${childrenPerOrganization}.`
        );
      }
    }

    // Parents come first in the list, so each depth is known when its children are reached.
    const depths = new Map<string, number>();
    const tooDeep: string[] = [];
    for (const organization of organizations) {
      let level = 1;
      if (organization.parentRef) {
        level = (depths.get(organization.parentRef) ?? 1) + 1;
      } else if (organization.parentId) {
        const parent = await context.findOrganization(organization.parentId);
        level = (parent?.ancestors?.length ?? 0) + 2;
      }
      depths.set(organization.ref, level);
      if (level > maxDepth) tooDeep.push(organization.displayName);
    }
    if (tooDeep.length > 0) {
      const names = tooDeep.slice(0, 5).map(name => `"${name}"`).join(', ');
      errors.push(
        `Organizations can be at most ${maxDepth} levels deep, counting from the top of the tree; ${names}${tooDeep.length > 5 ? ` and ${tooDeep.length - 5} more` : ''} would go deeper.`
      );
    }
  }

  private async buildUpdateSteps(
    context: BuildContext,
    updates: NonNullable<OrbitPlanDraft['updates']>,
    errors: string[]
  ): Promise<OrbitOperation[]> {
    const operations: OrbitOperation[] = [];
    const seen = new Set<string>();

    for (const update of updates) {
      const organizationId = typeof update?.organizationId === 'string' ? update.organizationId : '';
      const organization = await context.findOrganization(organizationId);
      if (!organization) {
        errors.push(`Cannot edit organization ${organizationId || '(missing id)'}: it does not exist.`);
        continue;
      }
      const label = labelOf(organization);
      if (!canManage(await context.roleIn(organizationId))) {
        errors.push(`You must be an OWNER or ADMIN of "${label}" to edit it.`);
        continue;
      }
      if (seen.has(organizationId)) {
        errors.push(`"${label}" is edited twice; merge both changes into one.`);
        continue;
      }
      seen.add(organizationId);

      const operation: Extract<OrbitOperation, { type: 'update_organization' }> = {
        type: 'update_organization',
        organization: { id: organizationId, label },
      };

      if (typeof update.displayName === 'string') {
        const displayName = update.displayName.trim();
        if (!displayName || displayName.length > ORBIT_PLAN_LIMITS.displayNameLength) {
          errors.push(`The new name for "${label}" must be between 1 and ${ORBIT_PLAN_LIMITS.displayNameLength} characters.`);
          continue;
        }
        if (!organization.isPersonal && !isRenameAllowed(displayName)) {
          errors.push(`"${displayName}" is too short to name "${label}": it needs at least three letters or digits.`);
          continue;
        }
        if (displayName !== organization.displayName) operation.displayName = displayName;
      }

      if (update.description !== undefined) {
        const description = typeof update.description === 'string' && update.description.trim()
          ? update.description.trim()
          : null;
        if (description && description.length > ORBIT_PLAN_LIMITS.descriptionLength) {
          errors.push(`The new description for "${label}" is longer than ${ORBIT_PLAN_LIMITS.descriptionLength} characters.`);
          continue;
        }
        if (description !== (organization.description ?? null)) operation.description = description;
      }

      if (operation.displayName === undefined && operation.description === undefined) {
        errors.push(`The edit of "${label}" does not change anything.`);
        continue;
      }
      operations.push(operation);
    }
    return operations;
  }

  private async buildMemberSteps(
    context: BuildContext,
    members: NonNullable<OrbitPlanDraft['members']>,
    errors: string[],
    warnings: string[]
  ): Promise<OrbitOperation[]> {
    const groups = new Map<string, { organization: OrbitOrgReference; members: Map<string, OrbitPlanMember> }>();

    for (const member of members) {
      const organization = await context.resolveTarget(member, 'add members to', errors);
      if (!organization) continue;

      const role = String(member?.role ?? '').trim().toUpperCase();
      if (role === 'OWNER') {
        errors.push(`"${member.user}" cannot join "${organization.label}" as OWNER: an organization has a single owner. Use ADMIN or MEMBER.`);
        continue;
      }
      if (role !== 'ADMIN' && role !== 'MEMBER') {
        errors.push(`"${member?.role}" is not a role; use ADMIN or MEMBER for "${member?.user}".`);
        continue;
      }

      const user = await context.resolveUser(member?.user, warnings);
      if (!user) continue;

      if (user.id === context.actor.id) {
        warnings.push(`You will already manage "${organization.label}", so you were not added to it as a member.`);
        continue;
      }
      if ('id' in organization && (await context.userRoleIn(user.id, organization.id)) !== null) {
        warnings.push(`@${user.username} already belongs to "${organization.label}" and was left out.`);
        continue;
      }

      const key = referenceKey(organization);
      const group = groups.get(key) ?? { organization, members: new Map() };
      groups.set(key, group);

      const existing = group.members.get(user.id);
      if (existing) {
        if (existing.role !== role) {
          warnings.push(`@${user.username} appears more than once in "${organization.label}" with different roles; ADMIN was kept.`);
          existing.role = 'ADMIN';
        }
        continue;
      }
      group.members.set(user.id, {
        userId: user.id,
        username: user.username,
        identifier: String(member.user).trim(),
        role: role as OrbitAssignableRole,
      });
    }

    return [...groups.values()]
      .filter(group => group.members.size > 0)
      .map(group => ({
        type: 'add_members' as const,
        organization: group.organization,
        members: [...group.members.values()],
      }));
  }

  private async buildInvitationSteps(
    context: BuildContext,
    invitations: NonNullable<OrbitPlanDraft['invitations']>,
    errors: string[],
    warnings: string[]
  ): Promise<OrbitOperation[]> {
    const groups = new Map<string, { organization: OrbitOrgReference; users: Map<string, OrbitPlanInvitee> }>();

    for (const invitation of invitations) {
      const organization = await context.resolveTarget(invitation, 'invite users to', errors);
      if (!organization) continue;

      const key = referenceKey(organization);
      const group = groups.get(key) ?? { organization, users: new Map() };
      groups.set(key, group);

      for (const identifier of asArray(invitation?.users)) {
        const user = await context.resolveUser(identifier, warnings);
        if (!user) continue;
        if (user.id === context.actor.id) continue;
        if ('id' in organization && (await context.userRoleIn(user.id, organization.id)) !== null) {
          warnings.push(`@${user.username} already belongs to "${organization.label}" and was not invited.`);
          continue;
        }
        group.users.set(user.id, { userId: user.id, username: user.username, identifier: String(identifier).trim() });
      }
    }

    return [...groups.values()]
      .filter(group => group.users.size > 0)
      .map(group => ({
        type: 'invite_users' as const,
        organization: group.organization,
        users: [...group.users.values()],
      }));
  }

  private async buildLinkSteps(
    context: BuildContext,
    links: NonNullable<OrbitPlanDraft['invitationLinks']>,
    errors: string[]
  ): Promise<OrbitOperation[]> {
    const operations: OrbitOperation[] = [];
    for (const link of links) {
      const organization = await context.resolveTarget(link, 'create invitation links for', errors);
      if (!organization) continue;

      const expiresInDays = link?.expiresInDays ?? DEFAULT_LINK_EXPIRY_DAYS;
      if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_LINK_EXPIRY_DAYS) {
        errors.push(`An invitation link must expire in 1 to ${MAX_LINK_EXPIRY_DAYS} whole days (got ${link?.expiresInDays}).`);
        continue;
      }
      const maxUses = link?.maxUses ?? null;
      if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_LINK_USES)) {
        errors.push(`An invitation link allows 1 to ${MAX_LINK_USES} uses, or leave it unlimited (got ${link?.maxUses}).`);
        continue;
      }
      operations.push({ type: 'create_invitation_link', organization, expiresInDays, maxUses });
    }
    return operations;
  }

  private async buildRoleChangeSteps(
    context: BuildContext,
    changes: NonNullable<OrbitPlanDraft['roleChanges']>,
    errors: string[],
    warnings: string[]
  ): Promise<OrbitOperation[]> {
    const groups = new Map<string, Extract<OrbitOperation, { type: 'change_member_roles' }>>();

    for (const change of changes) {
      const organization = await context.resolveExisting(change?.organizationId, 'change roles in', errors);
      if (!organization) continue;

      const role = String(change?.role ?? '').trim().toUpperCase();
      if (role === 'OWNER') {
        errors.push(`Nobody can be made OWNER of "${organization.label}" with a role change: an organization has a single owner. Hand it over with ownershipTransfer, in a plan of its own.`);
        continue;
      }
      if (role !== 'ADMIN' && role !== 'MEMBER') {
        errors.push(`"${change?.role}" is not a role; use ADMIN or MEMBER for "${change?.user}".`);
        continue;
      }

      const user = await context.resolveUser(change?.user, warnings);
      if (!user) continue;
      if (user.id === context.actor.id) {
        errors.push(`ORBIT cannot change your own role in "${organization.label}".`);
        continue;
      }

      const current = await context.directRoleOf(user.id, organization.id);
      if (!current) {
        warnings.push(await notAMemberWarning(context, user, organization, 'role'));
        continue;
      }
      if (current === 'OWNER') {
        errors.push(`@${user.username} owns "${organization.label}", and the owner's role cannot be changed. To give the organization to someone else, hand it over with ownershipTransfer.`);
        continue;
      }
      if (current === role) {
        warnings.push(`@${user.username} is already ${role} in "${organization.label}" and was left out.`);
        continue;
      }

      const group = groups.get(organization.id) ?? {
        type: 'change_member_roles' as const,
        organization: { id: organization.id, label: organization.label },
        changes: [],
      };
      groups.set(organization.id, group);
      const existing = group.changes.find(item => item.userId === user.id);
      if (existing) {
        if (existing.to !== role) errors.push(`@${user.username} is given two different roles in "${organization.label}"; keep one.`);
        continue;
      }
      group.changes.push({
        userId: user.id,
        username: user.username,
        identifier: String(change.user).trim(),
        from: current as OrbitAssignableRole,
        to: role as OrbitAssignableRole,
      });
    }
    return [...groups.values()].filter(group => group.changes.length > 0);
  }

  private async buildRemovalSteps(
    context: BuildContext,
    removals: NonNullable<OrbitPlanDraft['removals']>,
    errors: string[],
    warnings: string[]
  ): Promise<OrbitOperation[]> {
    const groups = new Map<string, Extract<OrbitOperation, { type: 'remove_members' }>>();

    for (const removal of removals) {
      const organization = await context.resolveExisting(removal?.organizationId, 'remove members from', errors);
      if (!organization) continue;

      const user = await context.resolveUser(removal?.user, warnings);
      if (!user) continue;
      if (user.id === context.actor.id) {
        errors.push(`ORBIT cannot remove you from "${organization.label}".`);
        continue;
      }

      const current = await context.directRoleOf(user.id, organization.id);
      if (!current) {
        warnings.push(await notAMemberWarning(context, user, organization, 'membership'));
        continue;
      }
      if (current === 'OWNER') {
        errors.push(`@${user.username} owns "${organization.label}" and cannot be removed from it. The owner has to hand it over first.`);
        continue;
      }

      const group = groups.get(organization.id) ?? {
        type: 'remove_members' as const,
        organization: { id: organization.id, label: organization.label },
        members: [],
      };
      groups.set(organization.id, group);
      if (group.members.some(member => member.userId === user.id)) continue;
      group.members.push({
        userId: user.id,
        username: user.username,
        identifier: String(removal.user).trim(),
        role: current as OrbitAssignableRole,
      });
    }
    return [...groups.values()].filter(group => group.members.length > 0);
  }

  private async buildRevocationSteps(
    context: BuildContext,
    revocations: NonNullable<OrbitPlanDraft['invitationRevocations']>,
    errors: string[]
  ): Promise<OrbitOperation[]> {
    const groups = new Map<string, Extract<OrbitOperation, { type: 'revoke_invitations' }>>();

    for (const revocation of revocations) {
      const organization = await context.resolveExisting(revocation?.organizationId, 'revoke invitations of', errors);
      if (!organization) continue;

      // A pasted link is taken too: the code is what comes after its last slash.
      const code = (String(revocation?.code ?? '').trim().split('/').pop() ?? '').trim().toLowerCase();
      if (!code) {
        errors.push('Every invitation to revoke needs its code (see list_invitations).');
        continue;
      }
      const invitation = (await context.invitationsOf(organization.id)).find(item => item.code.toLowerCase() === code);
      if (!invitation) {
        errors.push(`"${organization.label}" has no pending invitation with the code "${code}".`);
        continue;
      }

      const group = groups.get(organization.id) ?? {
        type: 'revoke_invitations' as const,
        organization: { id: organization.id, label: organization.label },
        invitations: [],
      };
      groups.set(organization.id, group);
      if (!group.invitations.some(item => item.id === invitation.id)) group.invitations.push(invitation);
    }
    return [...groups.values()].filter(group => group.invitations.length > 0);
  }

  /**
   * Moving takes owning both ends, as in the web app: the organization that
   * moves and the one it moves under. The branch keeps its shape, so the limits
   * are checked against where its deepest organization lands.
   */
  private async buildMoveSteps(
    context: BuildContext,
    moves: NonNullable<OrbitPlanDraft['moves']>,
    errors: string[],
    warnings: string[]
  ): Promise<OrbitOperation[]> {
    const operations: Extract<OrbitOperation, { type: 'move_organization' }>[] = [];
    const moved = new Map<string, any>();
    const errorsBefore = errors.length;

    for (const move of moves) {
      const organizationId = typeof move?.organizationId === 'string' ? move.organizationId.trim() : '';
      const organization = await context.findOrganization(organizationId);
      if (!organization) {
        errors.push(`Cannot move organization ${organizationId || '(missing id)'}: it does not exist.`);
        continue;
      }
      const label = labelOf(organization);
      if (moved.has(organizationId)) {
        errors.push(`"${label}" is moved twice; keep one destination.`);
        continue;
      }
      if (organization.isPersonal) {
        errors.push(`"${label}" is a personal organization and cannot be moved.`);
        continue;
      }
      if ((await context.roleIn(organizationId)) !== 'OWNER') {
        errors.push(`Only the OWNER of "${label}" can move it.`);
        continue;
      }

      const parentId = typeof move?.parentId === 'string' && move.parentId.trim() ? move.parentId.trim() : null;
      let destination: any = null;
      if (parentId) {
        if (parentId === organizationId) {
          errors.push(`"${label}" cannot be moved under itself.`);
          continue;
        }
        destination = await context.findOrganization(parentId);
        if (!destination) {
          errors.push(`Cannot move "${label}" under ${parentId}: that organization does not exist.`);
          continue;
        }
        const destinationLabel = labelOf(destination);
        if (destination.isPersonal) {
          errors.push(`"${destinationLabel}" is a personal organization and cannot have sub-organizations.`);
          continue;
        }
        if ((destination.ancestors ?? []).map(String).includes(organizationId)) {
          errors.push(`"${label}" cannot be moved under "${destinationLabel}", which sits inside it.`);
          continue;
        }
        if ((await context.roleIn(parentId)) !== 'OWNER') {
          errors.push(`You must be the OWNER of "${destinationLabel}" to move organizations under it.`);
          continue;
        }
      }

      const currentParentId = organization._parentId ? String(organization._parentId) : null;
      if (currentParentId === parentId) {
        warnings.push(`"${label}" is already ${parentId ? `under "${labelOf(destination)}"` : 'at the top level'} and was left out.`);
        continue;
      }

      const currentParent = currentParentId ? await context.findOrganization(currentParentId) : null;
      moved.set(organizationId, organization);
      operations.push({
        type: 'move_organization',
        organization: { id: organizationId, label },
        from: currentParentId ? { id: currentParentId, label: labelOf(currentParent) } : null,
        to: parentId ? { id: parentId, label: labelOf(destination) } : null,
      });
    }
    if (errors.length > errorsBefore) return [];

    // Moves that touch each other's branches would be checked against a tree
    // that no longer exists by the time the second one runs.
    for (const operation of operations) {
      const ancestors: string[] = (moved.get(operation.organization.id).ancestors ?? []).map(String);
      const insideAnother = operations.some(other => other !== operation && ancestors.includes(other.organization.id));
      const intoAnother = operation.to !== null && moved.has(operation.to.id);
      if (insideAnother || intoAnother) {
        errors.push(`"${operation.organization.label}" is moved together with an organization above it or around it; move them in separate plans.`);
        return [];
      }
    }

    const { childrenPerOrganization, depth: maxDepth } = ORBIT_PLAN_LIMITS;
    const arriving = new Map<string, number>();
    for (const operation of operations) {
      if (operation.to) arriving.set(operation.to.id, (arriving.get(operation.to.id) ?? 0) + 1);
    }
    for (const [destinationId, count] of arriving) {
      const existing = (await this.organizationRepository.findChildOrganizationIds(destinationId)).length;
      if (existing + count > childrenPerOrganization) {
        const label = labelOf(await context.findOrganization(destinationId));
        errors.push(`"${label}" would end up with ${existing + count} sub-organizations (${existing} already exist); an organization can have at most ${childrenPerOrganization}.`);
      }
    }

    for (const operation of operations) {
      const ownDepth = (moved.get(operation.organization.id).ancestors ?? []).length;
      const descendants = await context.descendantsOf(operation.organization.id);
      const height = descendants.reduce((deepest, descendant) => Math.max(deepest, descendant.ancestors.length - ownDepth), 0);
      const destination = operation.to ? await context.findOrganization(operation.to.id) : null;
      const newDepth = (destination ? (destination.ancestors ?? []).length + 2 : 1) + height;
      if (newDepth > maxDepth) {
        errors.push(`Moving "${operation.organization.label}" ${operation.to ? `under "${operation.to.label}"` : 'to the top level'} would leave part of its branch ${newDepth} levels deep; organizations can be at most ${maxDepth} levels deep.`);
      }
    }
    return errors.length > errorsBefore ? [] : operations;
  }

  /**
   * Handing over is a first-person act, as in the web app: it is the user's own
   * seat as owner that changes hands, so a platform administrator acting on an
   * organization they do not own cannot do it either.
   */
  private async buildOwnershipTransfer(
    context: BuildContext,
    transfer: NonNullable<OrbitPlanDraft['ownershipTransfer']>,
    errors: string[],
    warnings: string[]
  ): Promise<Extract<OrbitOperation, { type: 'transfer_ownership' }> | null> {
    const organizationId = typeof transfer?.organizationId === 'string' ? transfer.organizationId.trim() : '';
    const organization = await context.findOrganization(organizationId);
    if (!organization) {
      errors.push(`Cannot hand over organization ${organizationId || '(missing id)'}: it does not exist.`);
      return null;
    }
    const label = labelOf(organization);
    if (organization.isPersonal) {
      errors.push(`"${label}" is a personal organization and cannot be handed to anyone else.`);
      return null;
    }
    if ((await context.directRoleOf(context.actor.id, organizationId)) !== 'OWNER') {
      errors.push(`Only the owner of "${label}" can hand it over, and you are not its owner.`);
      return null;
    }

    const user = await context.resolveUser(transfer?.user, []);
    if (!user) {
      errors.push(`There is nobody to hand "${label}" over to: "${transfer?.user ?? ''}" is not a SPHERE account.`);
      return null;
    }
    if (user.id === context.actor.id) {
      errors.push(`You already own "${label}".`);
      return null;
    }
    if (!(await context.directRoleOf(user.id, organizationId))) {
      errors.push(`@${user.username} must be a member of "${label}" before it can be handed to them. Add them first, in a separate plan.`);
      return null;
    }

    const subOrganizations = (await context.descendantsOf(organizationId)).length;
    warnings.push(
      `@${user.username} becomes the owner of "${label}"${subOrganizations ? ` and its ${plural(subOrganizations, 'sub-organization')}` : ''}, and you stay as ADMIN. Only the new owner can give it back.`
    );
    return {
      type: 'transfer_ownership',
      organization: { id: organizationId, label },
      newOwner: { userId: user.id, username: user.username, identifier: String(transfer.user).trim() },
      subOrganizations,
    };
  }

  /**
   * Access to pricings and collections, for plain members: owners and admins
   * already have all of it. Each entry is the access the member ends up with,
   * so the plan shows exactly what changes against what they have now.
   */
  private async buildPermissionSteps(
    context: BuildContext,
    entries: NonNullable<OrbitPlanDraft['permissions']>,
    errors: string[],
    warnings: string[]
  ): Promise<OrbitOperation[]> {
    const groups = new Map<string, Extract<OrbitOperation, { type: 'set_permissions' }>>();
    const seen = new Set<string>();

    for (const entry of entries) {
      const organization = await context.resolveExisting(entry?.organizationId, 'manage permissions in', errors);
      if (!organization) continue;

      const resourceType = String(entry?.resourceType ?? '').trim().toLowerCase();
      if (resourceType !== 'pricing' && resourceType !== 'collection') {
        errors.push(`"${entry?.resourceType}" is not something permissions apply to; use pricing or collection.`);
        continue;
      }
      if (!Array.isArray(entry?.access)) {
        errors.push('Every permission entry needs "access": the list of accesses to end up with, empty to take them all away.');
        continue;
      }
      const requested = entry.access.map(item => String(item ?? '').trim().toUpperCase());
      const invalid = requested.filter(item => !ACCESS_ORDER.includes(item as OrbitAccess));
      if (invalid.length > 0) {
        errors.push(`${invalid.map(item => `"${item}"`).join(', ')} ${invalid.length === 1 ? 'is not an access' : 'are not accesses'}; use GET (view), PUT (edit), DELETE or CREATE.`);
        continue;
      }
      let access = ACCESS_ORDER.filter(item => requested.includes(item));

      const user = await context.resolveUser(entry?.user, warnings);
      if (!user) continue;
      const role = await context.userRoleIn(user.id, organization.id);
      if (!role) {
        warnings.push(`@${user.username} is not a member of "${organization.label}", so no access was changed for them.`);
        continue;
      }
      if (role === 'OWNER' || role === 'ADMIN') {
        warnings.push(`@${user.username} is ${role} of "${organization.label}" and already has full access to its pricings and collections; left out.`);
        continue;
      }

      const raw = typeof entry?.resource === 'string' ? entry.resource.trim() : '';
      let resourceSlug: string | null = null;
      let resourceLabel: string;
      if (!raw) {
        if (access.some(item => item !== 'CREATE')) {
          errors.push(`Access to the whole of "${organization.label}" can only allow CREATE (creating new ${resourceType}s). Name the ${resourceType} for GET, PUT or DELETE.`);
          continue;
        }
        resourceLabel = `new ${resourceType}s`;
      } else {
        const resource = await context.findResource(organization.id, resourceType, raw);
        if (!resource) {
          errors.push(`"${organization.label}" has no ${resourceType} called "${raw}". Check the names with list_resources.`);
          continue;
        }
        resourceSlug = resource.slug;
        resourceLabel = resource.name;
        if (resource.private && access.includes('PUT') && !access.includes('GET')) {
          access = ACCESS_ORDER.filter(item => item === 'GET' || access.includes(item));
          warnings.push(`"${resource.name}" is private, so @${user.username} also gets GET: editing it needs seeing it.`);
        }
      }

      const target = resourceSlug ? `"${resourceLabel}"` : resourceLabel;
      const key = `${organization.id}:${user.id}:${resourceType}:${resourceSlug ?? ''}`;
      if (seen.has(key)) {
        errors.push(`The access of @${user.username} to ${target} in "${organization.label}" is set twice; keep one.`);
        continue;
      }
      seen.add(key);

      const previous = await context.explicitAccessOf(user.id, organization.id, resourceType, resourceSlug);
      if (access.length === 0 && (!previous || previous.length === 0)) {
        warnings.push(`@${user.username} has no access of their own to ${target} in "${organization.label}" to take away; left out.`);
        continue;
      }
      if (previous && sameAccess(previous, access)) {
        warnings.push(`@${user.username} already has exactly that access to ${target} in "${organization.label}"; left out.`);
        continue;
      }

      const group = groups.get(organization.id) ?? {
        type: 'set_permissions' as const,
        organization: { id: organization.id, label: organization.label },
        changes: [] as OrbitPermissionChange[],
      };
      groups.set(organization.id, group);
      group.changes.push({
        userId: user.id,
        username: user.username,
        identifier: String(entry.user).trim(),
        resourceType: resourceType as OrbitResourceType,
        resourceSlug,
        resourceLabel,
        access,
        previous: previous && previous.length > 0 ? previous : null,
      });
    }
    return [...groups.values()].filter(group => group.changes.length > 0);
  }
}

/**
 * The lookups one build needs, cached so a file with hundreds of rows pointing at
 * the same organization or user costs one query for each, not one per row.
 */
interface BuildRepositories {
  organizationRepository: OrganizationRepository;
  organizationService: OrganizationService;
  userRepository: UserRepository;
  organizationMembershipRepository: OrganizationMembershipRepository;
  pricingRepository: PricingRepository;
  pricingCollectionRepository: PricingCollectionRepository;
}

type ResourceSummary = { slug: string; name: string; private: boolean };

export class BuildContext {
  readonly planOrganizations = new Map<string, string>();
  private organizations = new Map<string, any | null>();
  private roles = new Map<string, OrgRole | null>();
  private users = new Map<string, LeanUser | null>();
  private memberRoles = new Map<string, OrgRole | null>();
  private directRoles = new Map<string, OrgRole | null>();
  private invitations = new Map<string, Array<{ id: string; code: string }>>();
  private descendants = new Map<string, Array<{ id: string; ancestors: string[] }>>();
  private resources = new Map<string, ResourceSummary[]>();
  private organizationRepository: OrganizationRepository;
  private organizationService: OrganizationService;
  private userRepository: UserRepository;

  constructor(
    readonly actor: OrbitActor,
    private repositories: BuildRepositories
  ) {
    this.organizationRepository = repositories.organizationRepository;
    this.organizationService = repositories.organizationService;
    this.userRepository = repositories.userRepository;
  }

  /**
   * The role a user holds through a membership of this very organization. Role
   * changes and removals act on that membership; one inherited from a parent
   * organization is changed up there.
   */
  async directRoleOf(userId: string, organizationId: string): Promise<OrgRole | null> {
    const key = `${userId}:${organizationId}`;
    if (!this.directRoles.has(key)) {
      const membership: any = await this.repositories.organizationMembershipRepository.findExistingMembership(userId, organizationId);
      this.directRoles.set(key, (membership?.role as OrgRole) ?? null);
    }
    return this.directRoles.get(key) ?? null;
  }

  async invitationsOf(organizationId: string): Promise<Array<{ id: string; code: string }>> {
    if (!this.invitations.has(organizationId)) {
      const invitations: any[] = await this.organizationService.listInvitations(organizationId);
      this.invitations.set(
        organizationId,
        invitations.map(invitation => ({ id: String(invitation.id ?? invitation._id), code: String(invitation.code) }))
      );
    }
    return this.invitations.get(organizationId)!;
  }

  async descendantsOf(organizationId: string): Promise<Array<{ id: string; ancestors: string[] }>> {
    if (!this.descendants.has(organizationId)) {
      this.descendants.set(organizationId, await this.organizationRepository.findDescendants(organizationId));
    }
    return this.descendants.get(organizationId)!;
  }

  /** A pricing or collection of the organization, by slug or, failing that, by name. */
  async findResource(organizationId: string, type: OrbitResourceType, raw: string): Promise<ResourceSummary | null> {
    const key = `${type}:${organizationId}`;
    if (!this.resources.has(key)) {
      this.resources.set(
        key,
        type === 'pricing'
          ? await this.repositories.pricingRepository.findSummariesByOrganization(organizationId)
          : await this.repositories.pricingCollectionRepository.findSummariesByOrganization(organizationId)
      );
    }
    return matchResource(this.resources.get(key)!, raw);
  }

  /** The access a member was given explicitly, or null when there is no record of it. */
  async explicitAccessOf(
    userId: string,
    organizationId: string,
    type: OrbitResourceType,
    slug: string | null
  ): Promise<OrbitAccess[] | null> {
    const record = await findPermissionRecord(userId, organizationId, type, slug);
    return record ? accessOf(record.permissions) : null;
  }

  /** An existing organization the user manages; these changes never target one the plan creates. */
  async resolveExisting(
    rawId: string | null | undefined,
    action: string,
    errors: string[]
  ): Promise<{ id: string; label: string } | null> {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) {
      errors.push(`Every item needs the organizationId of an existing organization to know where to ${action}.`);
      return null;
    }
    const organization = await this.findOrganization(id);
    if (!organization) {
      errors.push(`Organization ${id} does not exist.`);
      return null;
    }
    if (!canManage(await this.roleIn(id))) {
      errors.push(`You must be an OWNER or ADMIN of "${labelOf(organization)}" to ${action} it.`);
      return null;
    }
    return { id, label: labelOf(organization) };
  }

  async findOrganization(id: string | null | undefined): Promise<any | null> {
    if (!id || !mongoose.isValidObjectId(id)) return null;
    if (!this.organizations.has(id)) {
      this.organizations.set(id, await this.organizationRepository.findById(id));
    }
    return this.organizations.get(id) ?? null;
  }

  async roleIn(organizationId: string): Promise<OrgRole | null> {
    if (!this.roles.has(organizationId)) {
      this.roles.set(organizationId, await resolveOrgRole(this.organizationService, this.actor, organizationId));
    }
    return this.roles.get(organizationId) ?? null;
  }

  async userRoleIn(userId: string, organizationId: string): Promise<OrgRole | null> {
    const key = `${userId}:${organizationId}`;
    if (!this.memberRoles.has(key)) {
      this.memberRoles.set(key, await this.organizationService.getUserOrgRole(userId, organizationId));
    }
    return this.memberRoles.get(key) ?? null;
  }

  /**
   * The organization a member, invitation or link item points at: one created
   * earlier in the plan, or an existing one the user manages.
   */
  async resolveTarget(
    item: { organizationId?: string | null; organizationRef?: string | null } | undefined,
    action: string,
    errors: string[]
  ): Promise<OrbitOrgReference | null> {
    const ref = typeof item?.organizationRef === 'string' ? item.organizationRef.trim() : '';
    const id = typeof item?.organizationId === 'string' ? item.organizationId.trim() : '';

    if (ref && id) {
      errors.push(`An item names both organizationRef "${ref}" and organizationId ${id}; give only one.`);
      return null;
    }
    if (ref) {
      const label = this.planOrganizations.get(ref);
      if (!label) {
        errors.push(`"${ref}" is not one of the organizations this plan creates.`);
        return null;
      }
      return { ref, label };
    }
    if (!id) {
      errors.push(`Every item needs an organizationId or an organizationRef to know where to ${action}.`);
      return null;
    }

    const organization = await this.findOrganization(id);
    if (!organization) {
      errors.push(`Organization ${id} does not exist.`);
      return null;
    }
    if (!canManage(await this.roleIn(id))) {
      errors.push(`You must be an OWNER or ADMIN of "${labelOf(organization)}" to ${action} it.`);
      return null;
    }
    return { id, label: labelOf(organization) };
  }

  /** A user named by email, username (with or without @) or id. */
  async resolveUser(identifier: unknown, warnings: string[]): Promise<LeanUser | null> {
    const raw = typeof identifier === 'string' ? identifier.trim() : '';
    if (!raw) {
      warnings.push('An empty user entry was left out.');
      return null;
    }
    const key = raw.toLowerCase();
    if (!this.users.has(key)) {
      let user: LeanUser | null = null;
      if (raw.includes('@') && !raw.startsWith('@')) {
        user = await this.userRepository.findByEmail(raw);
      } else if (/^[a-f0-9]{24}$/i.test(raw)) {
        user = await this.userRepository.findById(raw);
      } else {
        user = await this.userRepository.findByUsername(raw.replace(/^@/, ''));
      }
      this.users.set(key, user);
    }
    const user = this.users.get(key) ?? null;
    if (!user) warnings.push(`No SPHERE account matches "${raw}"; it was left out.`);
    return user;
  }
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/** The access flags that are on, in a fixed order. */
export function accessOf(permissions: Partial<Record<OrbitAccess, boolean>> | null | undefined): OrbitAccess[] {
  return ACCESS_ORDER.filter(item => permissions?.[item] === true);
}

function sameAccess(a: OrbitAccess[], b: OrbitAccess[]): boolean {
  return a.length === b.length && a.every(item => b.includes(item));
}

/** A pricing or collection named by its slug or, failing that, by its name. */
export function matchResource<T extends { slug: string; name: string }>(resources: T[], raw: string): T | null {
  const exact = raw.trim();
  const wanted = exact.toLowerCase();
  return (
    resources.find(resource => resource.slug === exact) ??
    resources.find(resource => resource.slug.toLowerCase() === wanted) ??
    resources.find(resource => (resource.name ?? '').trim().toLowerCase() === wanted) ??
    null
  );
}

/** The permission record of a member for a pricing, a collection, or (slug null) creating new ones. */
export async function findPermissionRecord(
  userId: string,
  organizationId: string,
  type: OrbitResourceType,
  slug: string | null
) {
  const repository: EntityPermissionRepository = container.resolve('entityPermissionRepository');
  return slug
    ? repository.findByUserEntityAndOrganization(userId, organizationId, type, slug)
    : repository.findByUserAndOrgScopedType(userId, organizationId, type);
}

/** Why someone named for a role change or a removal was left out. */
async function notAMemberWarning(
  context: BuildContext,
  user: LeanUser,
  organization: { id: string; label: string },
  what: 'role' | 'membership'
): Promise<string> {
  const inherited = await context.userRoleIn(user.id, organization.id);
  if (inherited) {
    return `@${user.username} is ${inherited} of "${organization.label}" through a parent organization, so their ${what} has to be changed there; left out.`;
  }
  return `@${user.username} is not a member of "${organization.label}" and was left out.`;
}

/** Nobody is removed from an organization in the same plan that changes their role or access in it. */
function checkRemovalConflicts(
  roleSteps: OrbitOperation[],
  permissionSteps: OrbitOperation[],
  removalSteps: OrbitOperation[],
  errors: string[]
) {
  const removed = new Set<string>();
  for (const step of removalSteps) {
    if (step.type !== 'remove_members') continue;
    for (const member of step.members) removed.add(`${step.organization.id}:${member.userId}`);
  }
  const clash = (organization: { id: string; label: string }, userId: string, username: string) => {
    if (removed.has(`${organization.id}:${userId}`)) {
      errors.push(`@${username} is removed from "${organization.label}" and changed in it in the same plan; keep only one of the two.`);
    }
  };
  for (const step of roleSteps) {
    if (step.type === 'change_member_roles') step.changes.forEach(change => clash(step.organization, change.userId, change.username));
  }
  for (const step of permissionSteps) {
    if (step.type === 'set_permissions') step.changes.forEach(change => clash(step.organization, change.userId, change.username));
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function labelOf(organization: any): string {
  return organization?.displayName || organization?.name || 'organization';
}

function referenceKey(reference: OrbitOrgReference): string {
  return 'id' in reference ? `id:${reference.id}` : `ref:${reference.ref}`;
}

/**
 * Orders new organizations so every parent is created before its children.
 * Whatever is left once no more can be placed sits on a cycle.
 */
function orderParentsFirst(organizations: DraftOrganization[]): { items: DraftOrganization[]; cycle: string[] } {
  const refs = new Set(organizations.map(organization => organization.ref));
  const placed = new Set<string>();
  const items: DraftOrganization[] = [];
  let pending = [...organizations];

  while (pending.length > 0) {
    // A parentRef that names nothing is reported on its own, not as a cycle.
    const ready = pending.filter(
      organization =>
        !organization.parentRef || placed.has(organization.parentRef) || !refs.has(organization.parentRef)
    );
    if (ready.length === 0) break;
    for (const organization of ready) {
      placed.add(organization.ref);
      items.push(organization);
    }
    pending = pending.filter(organization => !placed.has(organization.ref));
  }

  return { items, cycle: pending.map(organization => organization.ref) };
}

function describeOperation(operation: OrbitOperation): string {
  switch (operation.type) {
    case 'create_organization':
      return operation.parent
        ? `Create "${operation.displayName}" under "${operation.parent.label}"`
        : `Create "${operation.displayName}" as a top-level organization`;
    case 'update_organization': {
      const changes: string[] = [];
      if (operation.displayName !== undefined) changes.push(`rename it to "${operation.displayName}"`);
      if (operation.description !== undefined) {
        changes.push(operation.description ? 'change its description' : 'clear its description');
      }
      return `Edit "${operation.organization.label}": ${changes.join(' and ')}`;
    }
    case 'add_members': {
      const admins = operation.members.filter(member => member.role === 'ADMIN').length;
      const plain = operation.members.length - admins;
      const parts = [admins ? `${admins} ADMIN` : '', plain ? `${plain} MEMBER` : ''].filter(Boolean).join(', ');
      return `Add ${plural(operation.members.length, 'member')} to "${operation.organization.label}" (${parts})`;
    }
    case 'invite_users':
      return `Invite ${plural(operation.users.length, 'user')} to "${operation.organization.label}"`;
    case 'create_invitation_link': {
      const uses = operation.maxUses === null ? 'unlimited uses' : plural(operation.maxUses, 'use');
      return `Create an invitation link for "${operation.organization.label}" (expires in ${plural(operation.expiresInDays, 'day')}, ${uses})`;
    }
    case 'change_member_roles': {
      if (operation.changes.length === 1) {
        const [change] = operation.changes;
        return `Make @${change.username} ${change.to} in "${operation.organization.label}" (now ${change.from})`;
      }
      return `Change the role of ${plural(operation.changes.length, 'member')} in "${operation.organization.label}"`;
    }
    case 'remove_members':
      return operation.members.length === 1
        ? `Remove @${operation.members[0].username} from "${operation.organization.label}"`
        : `Remove ${plural(operation.members.length, 'member')} from "${operation.organization.label}"`;
    case 'revoke_invitations':
      return `Revoke ${plural(operation.invitations.length, 'invitation link')} of "${operation.organization.label}"`;
    case 'move_organization':
      return operation.to
        ? `Move "${operation.organization.label}" under "${operation.to.label}"`
        : `Move "${operation.organization.label}" to the top level`;
    case 'transfer_ownership':
      return `Hand "${operation.organization.label}" over to @${operation.newOwner.username}${operation.subOrganizations ? `, with its ${plural(operation.subOrganizations, 'sub-organization')}` : ''}`;
    case 'set_permissions': {
      const people = new Set(operation.changes.map(change => change.userId)).size;
      return `Change ${plural(operation.changes.length, 'permission')} of ${plural(people, 'member')} in "${operation.organization.label}"`;
    }
    case 'publish_pricing':
      return operation.existing
        ? `Publish version ${operation.version} of "${operation.pricingName}" in "${operation.organization.label}" from ${operation.attachment.filename}`
        : `Publish the pricing "${operation.pricingName}" ${operation.version} in "${operation.organization.label}" from ${operation.attachment.filename}`;
    case 'set_pricing_visibility':
      if (operation.changes.length === 1) {
        const [change] = operation.changes;
        return `Make "${change.label}"${change.version ? ` ${change.version}` : ''} ${change.private ? 'private' : 'public'} in "${operation.organization.label}"`;
      }
      return `Change the visibility of ${plural(operation.changes.length, 'pricing')} in "${operation.organization.label}"`;
    case 'fork_pricing':
      return `Fork "${operation.source.label}" ${operation.source.version} from "${operation.source.organizationLabel}" into "${operation.organization.label}" as "${operation.name}"`;
    case 'create_collection':
      return `Create the collection "${operation.name}" in "${operation.organization.label}"${operation.pricings.length ? ` with ${plural(operation.pricings.length, 'pricing')}` : ''}`;
    case 'update_collection_pricings': {
      const parts = [
        operation.add.length ? `add ${plural(operation.add.length, 'pricing')}` : '',
        operation.remove.length ? `remove ${plural(operation.remove.length, 'pricing')}` : '',
      ].filter(Boolean).join(' and ');
      return `In the collection "${operation.collection.label}": ${parts}`;
    }
    case 'mark_notifications_read':
      if (operation.all) return `Mark all ${plural(operation.count, 'unread notification')} as read`;
      return operation.count === 1
        ? `Mark the notification "${operation.notifications[0].title}" as read`
        : `Mark ${plural(operation.count, 'notification')} as read`;
    case 'update_notification_preferences':
      return operation.changes.length === 1
        ? `${operation.changes[0].label}: ${describeChannels(operation.changes[0])}`
        : `Change how ${plural(operation.changes.length, 'kind')} of notification reach you`;
    case 'update_profile': {
      if (operation.changes.length > 1) {
        return `Update your public profile: ${operation.changes.map(change => change.label).join(', ')}`;
      }
      const [change] = operation.changes;
      if (!change.to) return `Clear your ${change.label}`;
      const shown = change.to.length > 60 ? `${change.to.slice(0, 57)}...` : change.to;
      return `Set your ${change.label} to "${shown}"`;
    }
    case 'delete_pricing_versions':
      return operation.versions.length === 1
        ? `Delete version ${operation.versions[0]} of "${operation.pricing.label}" in "${operation.organization.label}"`
        : `Delete ${plural(operation.versions.length, 'version')} of "${operation.pricing.label}" in "${operation.organization.label}"`;
    case 'delete_pricing':
      return `Delete the pricing "${operation.pricing.label}" from "${operation.organization.label}", with its ${plural(operation.versions, 'version')}`;
    case 'delete_collection':
      return operation.withPricings
        ? `Delete the collection "${operation.collection.label}" of "${operation.organization.label}" and its ${plural(operation.pricings.length, 'pricing')}`
        : `Delete the collection "${operation.collection.label}" of "${operation.organization.label}", keeping its pricings`;
    case 'delete_organization':
      return operation.subOrganizations.length
        ? `Delete "${operation.organization.label}" and its ${plural(operation.subOrganizations.length, 'sub-organization')}`
        : `Delete "${operation.organization.label}"`;
  }
}

/** What a notification preference change turns on and off. */
function describeChannels(change: { from: { email: boolean; inbox: boolean }; to: { email: boolean; inbox: boolean } }): string {
  const parts: string[] = [];
  if (change.from.email !== change.to.email) parts.push(`turn ${change.to.email ? 'on' : 'off'} email`);
  if (change.from.inbox !== change.to.inbox) parts.push(`turn ${change.to.inbox ? 'on' : 'off'} in-app`);
  return parts.join(' and ');
}

function summarizeSteps(steps: OrbitPlanStep[]): string {
  const count = (type: OrbitOperation['type']) => steps.filter(step => step.operation.type === type);
  const parts: string[] = [];
  const creates = count('create_organization').length;
  if (creates) parts.push(`create ${plural(creates, 'organization')}`);
  const updates = count('update_organization').length;
  if (updates) parts.push(`edit ${plural(updates, 'organization')}`);
  const members = count('add_members').reduce((total, step) => total + (step.operation as any).members.length, 0);
  if (members) parts.push(`add ${plural(members, 'member')}`);
  const invitees = count('invite_users').reduce((total, step) => total + (step.operation as any).users.length, 0);
  if (invitees) parts.push(`invite ${plural(invitees, 'user')}`);
  const links = count('create_invitation_link').length;
  if (links) parts.push(`create ${plural(links, 'invitation link')}`);
  const roles = count('change_member_roles').reduce((total, step) => total + (step.operation as any).changes.length, 0);
  if (roles) parts.push(`change ${plural(roles, 'role')}`);
  const access = count('set_permissions').reduce((total, step) => total + (step.operation as any).changes.length, 0);
  if (access) parts.push(`change ${plural(access, 'permission')}`);
  const removed = count('remove_members').reduce((total, step) => total + (step.operation as any).members.length, 0);
  if (removed) parts.push(`remove ${plural(removed, 'member')}`);
  const revoked = count('revoke_invitations').reduce((total, step) => total + (step.operation as any).invitations.length, 0);
  if (revoked) parts.push(`revoke ${plural(revoked, 'invitation link')}`);
  const moves = count('move_organization').length;
  if (moves) parts.push(`move ${plural(moves, 'organization')}`);
  const published = count('publish_pricing').length;
  if (published) parts.push(`publish ${plural(published, 'pricing file')}`);
  const forked = count('fork_pricing').length;
  if (forked) parts.push(`fork ${plural(forked, 'pricing')}`);
  const collections = count('create_collection').length;
  if (collections) parts.push(`create ${plural(collections, 'collection')}`);
  const collectionEdits = count('update_collection_pricings').length;
  if (collectionEdits) parts.push(`change ${plural(collectionEdits, 'collection')}`);
  const visibility = count('set_pricing_visibility').reduce((total, step) => total + (step.operation as any).changes.length, 0);
  if (visibility) parts.push(`change the visibility of ${plural(visibility, 'pricing')}`);
  if (count('update_profile').length) parts.push('update your public profile');
  if (count('update_notification_preferences').length) parts.push('change your notification settings');
  const marked = count('mark_notifications_read').reduce((total, step) => total + (step.operation as any).count, 0);
  if (marked) parts.push(`mark ${plural(marked, 'notification')} as read`);
  const deletedVersions = count('delete_pricing_versions').reduce((total, step) => total + (step.operation as any).versions.length, 0);
  if (deletedVersions) parts.push(`delete ${plural(deletedVersions, 'pricing version')}`);
  const deletedPricings = count('delete_pricing').length;
  if (deletedPricings) parts.push(`delete ${plural(deletedPricings, 'pricing')}`);
  const deletedCollections = count('delete_collection').length;
  if (deletedCollections) parts.push(`delete ${plural(deletedCollections, 'collection')}`);
  const deletedOrganizations = count('delete_organization').length;
  if (deletedOrganizations) parts.push(`delete ${plural(deletedOrganizations, 'organization')}`);
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export default OrbitPlanService;
