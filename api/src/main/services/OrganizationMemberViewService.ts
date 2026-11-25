import mongoose from 'mongoose';
import container from '../config/container';
import { LeanUser } from '../types/models/User';
import { OrgRole } from '../types/models/Organization';
import PermissionService from './PermissionService';
import OrganizationService from './OrganizationService';

/** Who an organization is read as: one of its members, signed in as themselves. */
export type MemberReader = LeanUser & { orgRole: OrgRole };

/** In place of a member's id, asks for any plain member: the MEMBER role and no permission of their own. */
export const ANY_MEMBER = 'any';

/** Who a member view answers for: any plain member, or one member in particular. */
export type MemberAudience = { kind: 'any' } | { kind: 'member'; reader: MemberReader };

/**
 * Lets an organization's owners and admins read it as its members do (its
 * pricings, collections, services and hierarchy): as any plain member, who has
 * no permission of their own, or as one member in particular. It only settles
 * who to read as; the listings are then asked of the same services the
 * members' own requests reach, so the answers are theirs. Nothing here writes.
 *
 * An owner or admin may already read everything of their organization, so
 * reading it as a member shows them nothing they could not see.
 */
class OrganizationMemberViewService {
  private permissionService: PermissionService;
  private organizationService: OrganizationService;
  private userRepository: any;

  constructor() {
    this.permissionService = container.resolve('permissionService');
    this.organizationService = container.resolve('organizationService');
    this.userRepository = container.resolve('userRepository');
  }

  /**
   * Who to read the organization as. The caller must be in a SPHERE web
   * session (an API key or a connected application has no use for it) and be
   * an owner or admin of the organization, or a platform administrator. `userId`
   * is `any`, or someone who belongs to the organization.
   */
  async audience(organizationId: string, caller: LeanUser | undefined, userId: string, authType?: string): Promise<MemberAudience> {
    if (!caller || authType !== 'token') {
      throw new Error('PERMISSION ERROR: Viewing an organization as one of its members needs a SPHERE web session');
    }
    const access = await this.permissionService.actingAccess(caller, organizationId, authType);
    const manages = access.isGlobalAdmin || access.role === 'OWNER' || access.role === 'ADMIN';
    if (!access.reachable || !manages) {
      throw new Error('PERMISSION ERROR: Only owners and admins can view the organization as one of its members');
    }
    if (userId === ANY_MEMBER) return { kind: 'any' };

    const orgRole = mongoose.isValidObjectId(userId)
      ? await this.organizationService.getUserOrgRole(userId, organizationId)
      : null;
    const user = orgRole ? await this.userRepository.findById(userId) : null;
    if (!orgRole || !user) {
      throw new Error('NOT FOUND: Member not found');
    }

    // As the member signed in on the web: their own role in the organization,
    // never a platform administrator's bypass nor an API key's scopes.
    const reader = { id: userId, username: user.username, role: 'USER', orgRole } as MemberReader;
    return { kind: 'member', reader };
  }
}

/** Who a `/orgs/:organizationId/member-views/:userId/...` request reads the organization as. */
export function memberAudience(req: any): Promise<MemberAudience> {
  const service: OrganizationMemberViewService = container.resolve('organizationMemberViewService');
  return service.audience(req.params.organizationId, req.user, req.params.userId, req.authType);
}

export default OrganizationMemberViewService;
