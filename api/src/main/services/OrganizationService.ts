import crypto from 'node:crypto';
import container from '../config/container';
import OrganizationRepository from '../repositories/mongoose/OrganizationRepository';
import OrganizationMembershipRepository from '../repositories/mongoose/OrganizationMembershipRepository';
import OrganizationInvitationRepository from '../repositories/mongoose/OrganizationInvitationRepository';
import UserRepository from '../repositories/mongoose/UserRepository';
import NotificationService from './NotificationService';
import { OrgRole } from '../types/models/Organization';
import { LeanUser } from '../types/models/User';
import { processFileUris } from './FileService';
import { generateSlug } from '../utils/slug-manager';
import { OrganizationIndexByUserOptions } from '../types/services/Organization';

class OrganizationService {
  private organizationRepository: OrganizationRepository;
  private organizationMembershipRepository: OrganizationMembershipRepository;
  private organizationInvitationRepository: OrganizationInvitationRepository;
  private notificationService: NotificationService;
  private userRepository: UserRepository;

  constructor() {
    this.organizationRepository = container.resolve('organizationRepository');
    this.organizationMembershipRepository = container.resolve('organizationMembershipRepository');
    this.organizationInvitationRepository = container.resolve('organizationInvitationRepository');
    this.notificationService = container.resolve('notificationService');
    this.userRepository = container.resolve('userRepository');
  }

  async index() {
    const organizations = await this.organizationRepository.findAll({});
    organizations.forEach((org: any) => processFileUris(org, ['avatar']));
    return organizations;
  }

  async indexByUser(userId: string, options: OrganizationIndexByUserOptions) {
    const result = await this.organizationMembershipRepository.findOrganizationsByUserId(userId, options);

    const organizations = result.items;

    const processOrgs = (orgs: any[]) => {
      for (const org of orgs) {
        processFileUris(org, ['avatar']);
        if (org.subOrganizations?.length) {
          processOrgs(org.subOrganizations);
        }
      }
    };
    processOrgs(organizations);

    if (options.pagination && (typeof options.pagination.limit !== 'undefined' || typeof options.pagination.offset !== 'undefined')) {
      return {
        items: organizations,
        total: result.total,
      };
    }

    return organizations;
  }
  
  async getUserOrgRole(userId: string, organizationId: string): Promise<OrgRole | null> {
    const role = await this.organizationMembershipRepository.findUserRoleInOrganization(userId, organizationId);
    return role;
  }

  async show(id: string) {
    const organization = await this.organizationRepository.findById(id);
    if (!organization) {
      throw new Error('NOT FOUND: Organization not found');
    }
    processFileUris(organization, ['avatar']);
    return organization;
  }

  async createWithOwner(data: any, userId: string) {
    if (data._parentId) {
      const parent: any = await this.organizationRepository.findById(data._parentId);
      if (!parent) {
        throw new Error('NOT FOUND: Parent organization not found');
      }
      data.ancestors = [...(parent.ancestors ?? []), parent.id ?? parent._id?.toString()];
    }

    if (data.name && !data.isPersonal) {
      data.name = await this.deduplicateSlug(data.name);
    }

    const organization: any = await this.organizationRepository.create(data);
    const orgId = organization.id ?? organization._id?.toString();

    await this.organizationMembershipRepository.create({
      _userId: userId,
      _organizationId: orgId,
      role: 'OWNER',
      joinedAt: new Date(),
    });

    if (data._parentId) {
      await this.propagateMembershipsToChild(data._parentId, orgId);
    }

    return organization;
  }

  private async deduplicateSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    while (await this.organizationRepository.findExistingSlug(slug)) {
      const suffix = crypto.randomBytes(5).readUInt32BE(0).toString().slice(0, 10);
      slug = `${baseSlug}-${suffix}`;
    }
    return slug;
  }

  private async propagateMembershipsToChild(parentId: string, childId: string) {
    const parentMembers = await this.organizationMembershipRepository.findDirectMemberships(parentId);
    if (parentMembers.length === 0) return;

    const eligibleMembers = parentMembers.filter(
      (m: any) => m.role === 'OWNER' || m.role === 'ADMIN'
    );

    if (eligibleMembers.length === 0) return;

    const now = new Date();
    const memberships = eligibleMembers.map((m: any) => ({
      _userId: m._userId.toString(),
      _organizationId: childId,
      role: m.role as OrgRole,
      joinedAt: now,
    }));

    await this.organizationMembershipRepository.createBulk(memberships);
  }

  private async cascadeRoleChange(userId: string, organizationId: string, newRole: OrgRole) {
    const childIds = await this.organizationRepository.findChildOrganizationIds(organizationId);
    if (childIds.length === 0) return;

    if (newRole === 'MEMBER') {
      await this.organizationMembershipRepository.destroyByUserAndOrganizationBatch(
        childIds.map(id => userId),
        undefined as any
      );
      for (const childId of childIds) {
        await this.organizationMembershipRepository.destroyByUserAndOrganization(userId, childId);
      }
    } else {
      for (const childId of childIds) {
        const existing = await this.organizationMembershipRepository.findExistingMembership(userId, childId);
        if (existing) {
          await this.organizationMembershipRepository.updateByUserAndOrganization(userId, childId, { role: newRole });
        } else {
          await this.organizationMembershipRepository.create({
            _userId: userId,
            _organizationId: childId,
            role: newRole,
            joinedAt: new Date(),
          });
        }
      }
    }
  }

  async ensurePersonalOrganizationForUser(user: { id: string; username: string }) {
    const existing = await this.organizationRepository.findOne({ name: user.username, isPersonal: true });
    if (existing) {
      throw new Error(
        'CONFLICT: Cannot create personal organization because a personal organization with this name already exists. The user creation has been rolled back, but please contact support if you see this message as this should not happen under normal circumstances.'
      );
    }

    const organization = await this.organizationRepository.create({
      name: user.username.toLowerCase(),
      displayName: `${user.username} PERSONAL`,
      description: null,
      avatar: null,
      isPersonal: true,
    });

    await this.organizationMembershipRepository.create({
      _userId: user.id,
      _organizationId: (organization as any).id,
      role: 'OWNER',
      joinedAt: new Date(),
    });

    return organization;
  }

  async update(id: string, data: any) {
    const existing: any = await this.organizationRepository.findById(id);
    if (!existing) {
      throw new Error('NOT FOUND: Organization not found');
    }

    if (data.displayName && !existing.isPersonal && data.displayName !== existing.displayName) {
      const newSlug = generateSlug(data.displayName);
      if (newSlug.length < 3) {
        throw new Error('INVALID DATA: The organization name must produce a slug of at least 3 characters');
      }
      if (newSlug !== existing.name) {
        data.name = await this.deduplicateSlug(newSlug);
      }
    }

    const organization = await this.organizationRepository.update(id, data);
    if (!organization) {
      throw new Error('NOT FOUND: Organization not found');
    }
    processFileUris(organization, ['avatar']);
    return organization;
  }

  async destroy(id: string, skipPersonalCheck = false) {
    const organization = await this.organizationRepository.findById(id);
    if (!organization) {
      throw new Error('NOT FOUND: Organization not found');
    }

    if ((organization as any).isPersonal && !skipPersonalCheck) {
      throw new Error('PERMISSION ERROR: Personal organizations cannot be deleted');
    }

    await this.organizationMembershipRepository.destroyByOrganizationId(id);
    await this.organizationInvitationRepository.destroyByOrganizationId(id);
    const result = await this.organizationRepository.destroy(id);
    if (!result) {
      throw new Error('NOT FOUND: Organization not found');
    }
    return true;
  }

  async listMembers(organizationId: string, excludeUserId?: string) {
    const organization = await this.organizationRepository.findById(organizationId);
    if (!organization) {
      throw new Error('NOT FOUND: Organization not found');
    }

    const members = await this.organizationMembershipRepository.findByOrganizationId(organizationId);

    if (excludeUserId) {
      return members.filter((m: any) => m._userId !== excludeUserId);
    }

    members.forEach((m: any) => {
      if (m.user?.avatar) {
        processFileUris(m.user, ['avatar']);
      }
    });

    return members;
  }

  async addMember(userId: string, organizationId: string, role: OrgRole) {
    const existing = await this.organizationMembershipRepository.findUserRoleInOrganization(userId, organizationId);
    if (existing) {
      throw new Error('INVALID DATA: User is already a member of this organization');
    }

    if (role === 'OWNER') {
      const organization: any = await this.organizationRepository.findById(organizationId);
      if (!organization) {
        throw new Error('NOT FOUND: Organization not found');
      }
      if (organization.isPersonal) {
        throw new Error('PERMISSION ERROR: Personal organizations can only have one owner');
      }
    }

    const membership = await this.organizationMembershipRepository.create({
      _userId: userId,
      _organizationId: organizationId,
      role,
      joinedAt: new Date(),
    });

    if (role === 'OWNER' || role === 'ADMIN') {
      const childIds = await this.organizationRepository.findChildOrganizationIds(organizationId);
      if (childIds.length > 0) {
        const now = new Date();
        const childMemberships = childIds.map(childId => ({
          _userId: userId,
          _organizationId: childId,
          role,
          joinedAt: now,
        }));
        await this.organizationMembershipRepository.createBulk(childMemberships);
      }
    }

    return membership;
  }

  async updateMemberRole(userId: string, organizationId: string, role: OrgRole, reqUser: LeanUser & {orgRole: OrgRole}) {

    if (reqUser.orgRole !== 'OWNER' && role === 'OWNER') {
      throw new Error('PERMISSION ERROR: Only OWNER users can promote others to OWNER role');
    }

    const organization: any = await this.organizationRepository.findById(organizationId);
    if (!organization) {
      throw new Error('NOT FOUND: Organization not found');
    }

    if (role === 'OWNER' && organization.isPersonal) {
      throw new Error('PERMISSION ERROR: Personal organizations can only have one owner');
    }

    const currentMembership: any = await this.organizationMembershipRepository.findByUserAndOrganization(userId, organizationId);
    if (!currentMembership) {
      throw new Error('NOT FOUND: Organization membership not found');
    }

    if (currentMembership.role === 'OWNER' && reqUser.orgRole !== 'OWNER') {
      throw new Error('PERMISSION ERROR: Only OWNER users can modify the role of another OWNER');
    }

    if (currentMembership.role === 'OWNER' && role !== 'OWNER') {
      const ownerCount = await this.organizationMembershipRepository.countOwners(organizationId);
      if (ownerCount < 2) {
        throw new Error('PERMISSION ERROR: Cannot demote the last owner of the organization');
      }
    }

    const updatedMembership = await this.organizationMembershipRepository.updateByUserAndOrganization(
      userId,
      organizationId,
      { role }
    );

    await this.cascadeRoleChange(userId, organizationId, role);

    return updatedMembership;
  }

  async removeMember(userId: string, organizationId: string, reqUser?: LeanUser & {orgRole: OrgRole}) {
    const membership: any = await this.organizationMembershipRepository.findByUserAndOrganization(userId, organizationId);
    if (!membership) {
      throw new Error('NOT FOUND: Organization membership not found');
    }

    const isSelfRemoval = reqUser && userId === reqUser.id;

    if (!isSelfRemoval && membership.role === 'OWNER' && reqUser && reqUser.orgRole !== 'OWNER') {
      throw new Error('PERMISSION ERROR: Only OWNER users can remove another OWNER from the organization');
    }

    if (membership.role === 'OWNER') {
      const ownerCount = await this.organizationMembershipRepository.countOwners(organizationId);
      if (ownerCount < 2) {
        throw new Error('PERMISSION ERROR: Cannot remove the last owner of the organization');
      }
    }

    const result = await this.organizationMembershipRepository.destroyByUserAndOrganization(userId, organizationId);
    if (!result) {
      throw new Error('NOT FOUND: Organization membership not found');
    }

    const childIds = await this.organizationRepository.findChildOrganizationIds(organizationId);
    if (childIds.length > 0) {
      for (const childId of childIds) {
        await this.organizationMembershipRepository.destroyByUserAndOrganization(userId, childId);
      }
    }

    return true;
  }

  async createInvitation(organizationId: string, userId: string, options?: { expiresInDays?: number; maxUses?: number }) {
    const code = crypto.randomBytes(5).toString('hex');
    const expiresInDays = options?.expiresInDays ?? 7;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invitation = await this.organizationInvitationRepository.create({
      _organizationId: organizationId,
      code,
      createdBy: userId,
      expiresAt,
      maxUses: options?.maxUses ?? null,
      useCount: 0,
    });

    try {
      const org = await this.organizationRepository.findById(organizationId);
      const orgName = org?.displayName || org?.name || 'an organization';
      await this.notificationService.createNotification({
        userId,
        kind: 'System',
        title: 'Invitation link created',
        message: `You created an invitation link for "${orgName}"`,
        data: { organizationId, code, invitationId: String(invitation._id) },
      });
    } catch {
      // Notification creation should not fail the invitation
    }

    return invitation;
  }

  async listInvitations(organizationId: string) {
    return this.organizationInvitationRepository.findByOrganizationId(organizationId);
  }

  async revokeInvitation(invitationId: string) {
    const result = await this.organizationInvitationRepository.destroy(invitationId);
    if (!result) {
      throw new Error('NOT FOUND: Invitation not found');
    }
    return true;
  }

  async previewInvitation(code: string) {
    const invitation: any = await this.organizationInvitationRepository.findByCode(code);
    if (!invitation) {
      throw new Error('NOT FOUND: Invitation not found');
    }

    if (invitation.expiresAt && new Date(invitation.expiresAt as any) < new Date()) {
      throw new Error('NOT FOUND: Invitation expired');
    }

    if (invitation.maxUses !== null && invitation.useCount >= invitation.maxUses) {
      throw new Error('NOT FOUND: Invitation has reached the maximum number of uses');
    }

    const organization = await this.organizationRepository.findById(invitation._organizationId?.toString());
    if (!organization) {
      throw new Error('NOT FOUND: Organization not found');
    }

    return { invitation, organization };
  }

  async joinViaInvitation(code: string, userId: string) {
    const { invitation, organization } = await this.previewInvitation(code);
    const existing = await this.organizationMembershipRepository.findUserRoleInOrganization(userId, invitation._organizationId?.toString());

    if (existing) {
      throw new Error('INVALID DATA: User is already a member of this organization');
    }

    await this.organizationMembershipRepository.create({
      _userId: userId,
      _organizationId: invitation._organizationId?.toString(),
      role: 'MEMBER',
      joinedAt: new Date(),
    });

    await this.organizationInvitationRepository.incrementUseCount(invitation.id ?? invitation._id?.toString());

    return organization;
  }

  async inviteUsersToOrganization(organizationId: string, invitedUserIds: string[], invitedBy: string) {
    // Create invitation with maxUses = number of invited users
    const code = crypto.randomBytes(5).toString('hex');
    const expiresInDays = 7;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invitation = await this.organizationInvitationRepository.create({
      _organizationId: organizationId,
      code,
      createdBy: invitedBy,
      expiresAt,
      maxUses: invitedUserIds.length,
      useCount: 0,
    });

    // Get organization name for notifications
    const org = await this.organizationRepository.findById(organizationId);
    const orgName = org?.displayName || org?.name || 'an organization';

    // Get inviter name
    const inviter = await this.userRepository.findById(invitedBy);
    const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}` : 'Someone';

    // Create notification for each invited user
    for (const userId of invitedUserIds) {
      try {
        await this.notificationService.createNotification({
          userId,
          kind: 'OrganizationInvitation',
          title: `You've been invited to join ${orgName}`,
          message: `${inviterName} has invited you to join "${orgName}". Click to accept the invitation.`,
          data: {
            invitationCode: code,
            organizationId,
            organizationName: orgName,
            invitedBy: inviterName,
            invitedById: invitedBy,
          },
        });
      } catch {
        // Notification creation should not fail the invitation process
      }
    }

    return invitation;
  }
}

export default OrganizationService;
