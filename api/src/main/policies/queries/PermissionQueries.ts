import container from '../../config/container';
import EntityPermissionRepository from '../../repositories/mongoose/EntityPermissionRepository';
import OrganizationMembershipRepository from '../../repositories/mongoose/OrganizationMembershipRepository';
import { EntityPermissions, LeanEntityPermission } from '../../types/models/EntityPermission';
import { OrgRole } from '../../types/models/Organization';
import { BatchEvaluationContext } from '../../types/policies';

type PermissionMaps = {
  orgPermissions: Map<string, EntityPermissions>;
  entityPermissions: Map<string, EntityPermissions>;
  collectionPermissions: Map<string, EntityPermissions>;
};

/**
 * PermissionQueries - Batch database lookups for permission evaluation.
 *
 * Eliminates N+1 query patterns by fetching all required permissions
 * in a minimal number of queries.
 *
 * Usage:
 *   const queries = new PermissionQueries();
 *   const batchCtx = await queries.buildBatchContext('user1', 'org1');
 *   const results = engine.evaluateBatch(contexts, { batchContext: batchCtx });
 */
export class PermissionQueries {
  private entityPermissionRepository: EntityPermissionRepository;
  private organizationMembershipRepository: OrganizationMembershipRepository;

  constructor() {
    this.entityPermissionRepository = container.resolve('entityPermissionRepository');
    this.organizationMembershipRepository = container.resolve('organizationMembershipRepository');
  }

  /**
   * Build a batch evaluation context for a user in an organization.
   * Fetches all permissions in minimal DB queries.
   *
   * @returns BatchEvaluationContext with pre-fetched data
   */
  async buildBatchContext(
    userId: string,
    organizationId: string,
    userOrgRole?: OrgRole | null,
    isGlobalAdmin?: boolean
  ): Promise<BatchEvaluationContext> {
    const orgScopedPermissions = await this.fetchOrgScopedPermissions(userId, organizationId);
    const entityPermissions = await this.fetchEntityPermissions(userId, organizationId);
    const collectionPermissions = this.extractCollectionPermissions(entityPermissions);

    return {
      userId,
      organizationId,
      userOrgRole,
      isGlobalAdmin,
      orgPermissions: orgScopedPermissions,
      entityPermissions,
      collectionPermissions,
    };
  }

  /**
   * Build batch evaluation contexts for a user across ALL their organizations.
   * Fetches all data in just 2 DB queries regardless of org count.
   *
   * @returns Map of organizationId → BatchEvaluationContext
   */
  async buildAllOrgsBatchContext(
    userId: string,
    isGlobalAdmin?: boolean
  ): Promise<Map<string, BatchEvaluationContext>> {
    const orgRoles = await this.organizationMembershipRepository.findRolesByUserId(userId);
    const allEntityPerms = await this.entityPermissionRepository.findByUser(userId);

    const orgPermsMap = new Map<string, LeanEntityPermission[]>();
    for (const perm of allEntityPerms) {
      const orgId = perm._organizationId;
      if (!orgPermsMap.has(orgId)) {
        orgPermsMap.set(orgId, []);
      }
      orgPermsMap.get(orgId)!.push(perm);
    }

    const contexts = new Map<string, BatchEvaluationContext>();

    for (const [orgId, orgRole] of orgRoles) {
      const orgPerms = orgPermsMap.get(orgId) ?? [];
      const maps = this.buildPermissionMapsFromRecords(orgPerms);

      contexts.set(orgId, {
        userId,
        organizationId: orgId,
        userOrgRole: orgRole,
        isGlobalAdmin,
        orgPermissions: maps.orgPermissions,
        entityPermissions: maps.entityPermissions,
        collectionPermissions: maps.collectionPermissions,
      });
    }

    return contexts;
  }

  /**
   * Build permission maps from an array of raw permission records.
   * Shared helper used by both buildBatchContext and buildAllOrgsBatchContext.
   */
  private buildPermissionMapsFromRecords(records: LeanEntityPermission[]): PermissionMaps {
    const orgPermissions = new Map<string, EntityPermissions>();
    const entityPermissions = new Map<string, EntityPermissions>();

    for (const perm of records) {
      if (!perm.entitySlug) {
        orgPermissions.set(perm.entityType, perm.permissions);
      } else {
        entityPermissions.set(`${perm.entityType}:${perm.entitySlug}`, perm.permissions);
      }
    }

    const collectionPermissions = this.extractCollectionPermissions(entityPermissions);

    return { orgPermissions, entityPermissions, collectionPermissions };
  }

  /**
   * Extract collection permissions from entity permissions map.
   * Used for pricing inheritance (pricing inside collection).
   */
  private extractCollectionPermissions(
    entityPermissions: Map<string, EntityPermissions>
  ): Map<string, EntityPermissions> {
    const collectionPermissions = new Map<string, EntityPermissions>();

    for (const [key, perms] of entityPermissions) {
      if (key.startsWith('collection:')) {
        collectionPermissions.set(key.replace('collection:', ''), perms);
      }
    }

    return collectionPermissions;
  }

  /**
   * Fetch org-scoped permissions (entitySlug = null) for CREATE checks.
   */
  private async fetchOrgScopedPermissions(
    userId: string,
    organizationId: string
  ): Promise<Map<string, EntityPermissions>> {
    const permissions = new Map<string, EntityPermissions>();

    const orgPricingPerm = await this.entityPermissionRepository.findByUserAndOrgScopedType(
      userId,
      organizationId,
      'pricing'
    );
    if (orgPricingPerm) {
      permissions.set('pricing', orgPricingPerm.permissions);
    }

    const orgCollectionPerm = await this.entityPermissionRepository.findByUserAndOrgScopedType(
      userId,
      organizationId,
      'collection'
    );
    if (orgCollectionPerm) {
      permissions.set('collection', orgCollectionPerm.permissions);
    }

    return permissions;
  }

  /**
   * Fetch all entity-level permissions for a user in an organization.
   * Returns a Map keyed by "entityType:entitySlug".
   */
  private async fetchEntityPermissions(
    userId: string,
    organizationId: string
  ): Promise<Map<string, EntityPermissions>> {
    const permissions = new Map<string, EntityPermissions>();

    const entityPerms = await this.entityPermissionRepository.findByUserAndOrganization(
      userId,
      organizationId
    );

    for (const perm of entityPerms) {
      if (perm.entitySlug) {
        const key = `${perm.entityType}:${perm.entitySlug}`;
        permissions.set(key, perm.permissions);
      }
    }

    return permissions;
  }

  /**
   * Resolve organization role for a user.
   * Handles hierarchical org membership (parent org roles).
   */
  async resolveOrgRole(
    userId: string,
    organizationId: string
  ): Promise<OrgRole | null> {
    const role = await this.organizationMembershipRepository.findUserRoleInOrganization(
      userId,
      organizationId
    );
    return role as OrgRole | null;
  }
}
