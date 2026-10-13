import mongoose from 'mongoose';
import container from '../../config/container';
import OrganizationRepository from '../../repositories/mongoose/OrganizationRepository';
import UserRepository from '../../repositories/mongoose/UserRepository';
import OrbitPlanRepository from '../../repositories/mongoose/OrbitPlanRepository';
import OrbitAuditLogRepository from '../../repositories/mongoose/OrbitAuditLogRepository';
import OrganizationService from '../OrganizationService';
import { OrgRole } from '../../types/models/Organization';
import { LeanUser } from '../../types/models/User';
import {
  LeanOrbitPlan,
  OrbitAssignableRole,
  OrbitIgnoredRow,
  OrbitOperation,
  OrbitOrgReference,
  OrbitPlanDraft,
  OrbitPlanInvitee,
  OrbitPlanMember,
  OrbitPlanSource,
  OrbitPlanStep,
} from '../../types/models/Orbit';
import { canManage, isRenameAllowed, OrbitActor, resolveOrgRole } from './orbitAccess';

/**
 * Hard limits on what ORBIT may do, enforced here by code whatever the model
 * proposes. The model is told them too, so it can split the work or ask first.
 */
export const ORBIT_PLAN_LIMITS = {
  organizations: 200,
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
};

const DEFAULT_LINK_EXPIRY_DAYS = 7;
const MAX_LINK_EXPIRY_DAYS = 365;
const MAX_LINK_USES = 10_000;

export type OrbitPlanBuildResult =
  | { ok: true; summary: string; steps: OrbitPlanStep[]; warnings: string[] }
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

  constructor() {
    this.organizationRepository = container.resolve('organizationRepository');
    this.organizationService = container.resolve('organizationService');
    this.userRepository = container.resolve('userRepository');
    this.orbitPlanRepository = container.resolve('orbitPlanRepository');
    this.orbitAuditLogRepository = container.resolve('orbitAuditLogRepository');
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
    options: { source?: OrbitPlanSource; ignoredRows?: OrbitIgnoredRow[]; warnings?: string[] } = {}
  ): Promise<OrbitProposeResult> {
    const built = await this.build(actor, draft, options.warnings ?? []);
    if (!built.ok) return built;

    await this.orbitPlanRepository.supersedePending(conversationId);
    const plan = await this.orbitPlanRepository.create({
      userId: actor.id,
      conversationId,
      summary: built.summary,
      source: options.source ?? 'chat',
      steps: built.steps,
      warnings: built.warnings,
      ignoredRows: options.ignoredRows ?? [],
    });
    return { ok: true, plan };
  }

  async build(
    actor: OrbitActor,
    draft: OrbitPlanDraft,
    initialWarnings: string[] = []
  ): Promise<OrbitPlanBuildResult> {
    const context = new BuildContext(actor, this.organizationRepository, this.organizationService, this.userRepository);
    const errors: string[] = [];
    const warnings: string[] = [...initialWarnings];

    const organizations = asArray(draft.organizations);
    const updates = asArray(draft.updates);
    const members = asArray(draft.members);
    const invitations = asArray(draft.invitations);
    const links = asArray(draft.invitationLinks);

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
    if (errors.length > 0) return { ok: false, errors, warnings };

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

    if (errors.length > 0) return { ok: false, errors: unique(errors), warnings: unique(warnings) };

    const operations = [...createSteps, ...updateSteps, ...memberSteps, ...inviteSteps, ...linkSteps];
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

    return { ok: true, summary, steps, warnings: unique(warnings) };
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
}

/**
 * The lookups one build needs, cached so a file with hundreds of rows pointing at
 * the same organization or user costs one query for each, not one per row.
 */
class BuildContext {
  readonly planOrganizations = new Map<string, string>();
  private organizations = new Map<string, any | null>();
  private roles = new Map<string, OrgRole | null>();
  private users = new Map<string, LeanUser | null>();
  private memberRoles = new Map<string, OrgRole | null>();

  constructor(
    readonly actor: OrbitActor,
    private organizationRepository: OrganizationRepository,
    private organizationService: OrganizationService,
    private userRepository: UserRepository
  ) {}

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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function labelOf(organization: any): string {
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
  }
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
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export default OrbitPlanService;
