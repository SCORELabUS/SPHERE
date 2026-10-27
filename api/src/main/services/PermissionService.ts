import container from '../config/container';
import EntityPermissionRepository from '../repositories/mongoose/EntityPermissionRepository';
import OrganizationMembershipRepository from '../repositories/mongoose/OrganizationMembershipRepository';
import PricingRepository from '../repositories/mongoose/PricingRepository';
import PricingCollectionRepository from '../repositories/mongoose/PricingCollectionRepository';
import {
  BulkSetEntityPermissionsResult,
  EntityType,
  EntityPermissions,
  LeanEntityPermission,
  PermissionType,
  SetEntityPermissionInput,
} from '../types/models/EntityPermission';
import { OrgRole } from '../types/models/Organization';
import { LeanUser } from '../types/models/User';
import { PricingIndexQueryParams } from '../types/services/PricingService';
import { CollectionIndexQueryParams } from '../types/services/PricingCollection';
import { PermissionQueries } from '../policies/queries/PermissionQueries';
import { BatchEvaluationContext, OrgUserPermissionsContext } from '../types/policies';
import { ActingAccess, actingAccess, PrivateReader, privateReader, PrivateReadSources } from '../policies/privateReadRule';

const FULL_PERMISSIONS: EntityPermissions = { GET: true, PUT: true, DELETE: true, CREATE: true };
const NO_PERMISSIONS: EntityPermissions = { GET: false, PUT: false, DELETE: false, CREATE: false };

class PermissionService {
  private entityPermissionRepository: EntityPermissionRepository;
  private organizationMembershipRepository: OrganizationMembershipRepository;
  private pricingRepository: PricingRepository;
  private pricingCollectionRepository: PricingCollectionRepository;
  private permissionQueries: PermissionQueries;

  constructor() {
    this.entityPermissionRepository = container.resolve('entityPermissionRepository');
    this.organizationMembershipRepository = container.resolve('organizationMembershipRepository');
    this.pricingRepository = container.resolve('pricingRepository');
    this.pricingCollectionRepository = container.resolve('pricingCollectionRepository');
    this.permissionQueries = new PermissionQueries();
  }

  async resolveOrgRole(userId: string, organizationId: string): Promise<OrgRole | null> {
    return this.permissionQueries.resolveOrgRole(userId, organizationId);
  }

  async buildBatchContext(
    userId: string,
    organizationId: string,
    userOrgRole?: OrgRole | null,
    isGlobalAdmin?: boolean
  ): Promise<BatchEvaluationContext> {
    return this.permissionQueries.buildBatchContext(userId, organizationId, userOrgRole, isGlobalAdmin);
  }

  async buildAllOrgsBatchContext(
    userId: string,
    isGlobalAdmin?: boolean
  ): Promise<Map<string, BatchEvaluationContext>> {
    return this.permissionQueries.buildAllOrgsBatchContext(userId, isGlobalAdmin);
  }

  /** Roles, permissions and the organization tree, as the private read rule needs them. */
  private get readSources(): PrivateReadSources {
    return {
      resolveOrgRole: (userId, organizationId) => this.resolveOrgRole(userId, organizationId),
      buildBatchContext: (userId, organizationId, role, isGlobalAdmin) =>
        this.buildBatchContext(userId, organizationId, role, isGlobalAdmin),
      findOrganization: organizationId => container.resolve('organizationRepository').findById(organizationId),
    };
  }

  /**
   * How a caller acts in an organization once the API key it came with, if
   * any, is applied (see `policies/privateReadRule.ts`): VIEW as a plain
   * MEMBER, MANAGEMENT at most as an ADMIN, no access without a scope, and no
   * global ADMIN bypass for keys.
   */
  async actingAccess(reqUser: LeanUser | undefined, organizationId: string, authType?: string): Promise<ActingAccess> {
    return actingAccess(this.readSources, reqUser as any, organizationId, authType);
  }

  /**
   * A check of whether the caller may read private entities of one
   * organization: the private versions of a pricing (GET on it or on its
   * collection) or a private collection. It is the rule
   * `PermanentLinkService.authorize` applies (see `policies/privateReadRule.ts`),
   * built once per organization so listings can ask it for many entities.
   */
  async privateReader(reqUser: LeanUser | undefined, organizationId: string, authType?: string): Promise<PrivateReader> {
    return privateReader(this.readSources, reqUser as any, organizationId, authType);
  }

  /** Whether the caller may read the private versions of one pricing (see `privateReader`). */
  async canReadPrivateVersions(
    reqUser: LeanUser | undefined,
    pricing: { organizationId: string; slug: string; collectionSlug?: string | null },
    authType?: string
  ): Promise<boolean> {
    return (await this.privateReader(reqUser, pricing.organizationId, authType))('pricing', pricing.slug, pricing.collectionSlug);
  }

  /**
   * Narrows a listing context built from the user's own roles and permissions
   * to how the request acts: with an API key, organizations the key does not
   * reach give nothing, and OWNER/ADMIN access only remains where the key
   * keeps it (see `actingAccess`). The global ADMIN bypass is a token's only.
   */
  async narrowListingToCaller(reqUser: LeanUser, context: OrgUserPermissionsContext): Promise<OrgUserPermissionsContext> {
    if (!(reqUser as any).apiKey) return context;
    const organizationIds = new Set<string>([
      ...context.adminOrgIds,
      ...[...(context.pricingKeys ?? []), ...(context.collectionKeys ?? [])].map(key => key.split(':')[0]),
    ]);
    const reachable = new Set<string>();
    const adminOrgIds: string[] = [];
    for (const organizationId of organizationIds) {
      const access = await this.actingAccess(reqUser, organizationId);
      if (!access.reachable || !access.role) continue;
      reachable.add(organizationId);
      if (access.role === 'OWNER' || access.role === 'ADMIN') adminOrgIds.push(organizationId);
    }
    const inReach = (keys?: string[]) => (keys ?? []).filter(key => reachable.has(key.split(':')[0]));
    return {
      ...context,
      orgRole: context.orgRole === 'OWNER' || context.orgRole === 'ADMIN' ? null : context.orgRole,
      isGlobalAdmin: false,
      adminOrgIds,
      pricings: [],
      collections: [],
      pricingKeys: inReach(context.pricingKeys),
      collectionKeys: inReach(context.collectionKeys),
    };
  }

  async buildOrgUserPermissionsContext(
    reqUser: LeanUser,
    orgRole: OrgRole | null,
    organizationId: string
  ): Promise<OrgUserPermissionsContext> {
    const orgPermissions: BatchEvaluationContext = await this.buildBatchContext(
      reqUser.id,
      organizationId,
      orgRole,
      reqUser.role === 'ADMIN'
    );

    const entriesWithGetPermissions = Array.from(orgPermissions.entityPermissions.entries())
      .filter(([_, permissions]) => permissions.GET === true)
      .map(([key]) => key);

    const pricingsWithGetPermissions = entriesWithGetPermissions
      .filter(key => key.startsWith('pricing:'))
      .map(key => key.split(':')[1]);
    const collectionsWithGetPermissions = entriesWithGetPermissions
      .filter(key => key.startsWith('collection:'))
      .map(key => key.split(':')[1]);

    return {
      orgRole: orgPermissions.isGlobalAdmin ? 'OWNER' : orgRole,
      pricings: pricingsWithGetPermissions,
      pricingKeys: pricingsWithGetPermissions.map(slug => `${organizationId}:${slug}`),
      collections: collectionsWithGetPermissions,
      collectionKeys: collectionsWithGetPermissions.map(slug => `${organizationId}:${slug}`),
      isGlobalAdmin: orgPermissions.isGlobalAdmin ?? false,
      adminOrgIds: (orgRole === 'OWNER' || orgRole === 'ADMIN' || orgPermissions.isGlobalAdmin)
        ? [organizationId]
        : [],
    };
  }

  async buildUserPermissionsContext(reqUser: LeanUser): Promise<OrgUserPermissionsContext> {
    const permissions: Map<string, BatchEvaluationContext> = await this.buildAllOrgsBatchContext(
      reqUser.id,
      reqUser.role === 'ADMIN'
    );

    const pricingsWithGetPermissions: string[] = [];
    const pricingKeys: string[] = [];
    const collectionsWithGetPermissions: string[] = [];
    const collectionsWithPutPermissions: string[] = [];
    const collectionKeys: string[] = [];
    const adminOrgIds: string[] = [];

    for (const [orgId, orgPermissions] of permissions) {
      if (orgPermissions.userOrgRole === 'OWNER' || orgPermissions.userOrgRole === 'ADMIN') {
        adminOrgIds.push(orgId);
        continue;
      }

      const entriesWithGetPermissions = Array.from(orgPermissions.entityPermissions.entries())
        .filter(([_, permissionEntry]) => permissionEntry.GET === true)
        .map(([key]) => key);

      const entriesWithPutPermissions = Array.from(orgPermissions.entityPermissions.entries())
        .filter(([_, permissionEntry]) => permissionEntry.GET === true && permissionEntry.PUT === true)
        .map(([key]) => key);

      pricingsWithGetPermissions.push(
        ...entriesWithGetPermissions
          .filter(key => key.startsWith('pricing:'))
          .map(key => key.split(':')[1])
      );

      // Qualified by organization too, as slugs repeat across organizations.
      pricingKeys.push(
        ...entriesWithGetPermissions
          .filter(key => key.startsWith('pricing:'))
          .map(key => `${orgId}:${key.split(':')[1]}`)
      );

      collectionsWithGetPermissions.push(
        ...entriesWithGetPermissions
          .filter(key => key.startsWith('collection:'))
          .map(key => key.split(':')[1])
      );

      // Qualified by organization: a slug is only unique inside its organization.
      collectionsWithPutPermissions.push(
        ...entriesWithPutPermissions
          .filter(key => key.startsWith('collection:'))
          .map(key => `${orgId}:${key.split(':')[1]}`)
      );

      // The same for the collections it may see.
      collectionKeys.push(
        ...entriesWithGetPermissions
          .filter(key => key.startsWith('collection:'))
          .map(key => `${orgId}:${key.split(':')[1]}`)
      );
    }

    return {
      orgRole: null,
      pricings: pricingsWithGetPermissions,
      pricingKeys,
      collections: collectionsWithGetPermissions,
      collectionsWritable: collectionsWithPutPermissions,
      collectionKeys,
      isGlobalAdmin: reqUser.role === 'ADMIN',
      adminOrgIds,
    };
  }

  /**
   * Returns effective permissions for a user on an entity.
   * OWNER/ADMIN always get full permissions.
   * For MEMBERs, looks up EntityPermission records.
   */
  private async getEffectivePermissions(
    userId: string,
    organizationId: string,
    entityType: EntityType,
    entitySlug: string,
    userOrgRole?: OrgRole | null
  ): Promise<EntityPermissions> {
    if (userOrgRole === 'OWNER' || userOrgRole === 'ADMIN') {
      return { ...FULL_PERMISSIONS };
    }

    const permission = await this.entityPermissionRepository.findByUserEntityAndOrganization(
      userId,
      organizationId,
      entityType,
      entitySlug
    );

    if (!permission) {
      return { ...NO_PERMISSIONS };
    }

    return { ...permission.permissions };
  }

  /**
   * Checks if a user has a specific permission on an entity.
   */
  async hasPermission(
    userId: string,
    organizationId: string,
    entityType: EntityType,
    entitySlug: string,
    permission: PermissionType,
    userOrgRole?: OrgRole | null
  ): Promise<boolean> {
    if (userOrgRole === 'OWNER' || userOrgRole === 'ADMIN') {
      return true;
    }

    const perms = await this.getEffectivePermissions(userId, organizationId, entityType, entitySlug, userOrgRole);
    return perms[permission] === true;
  }

  /**
   * Sets permissions for a user on an entity. Only OWNER/ADMIN can call this.
   * When entitySlug is null, sets org-scoped permissions (e.g., CREATE).
   */
  async setPermission(
    organizationId: string,
    userId: string,
    entityType: EntityType,
    entitySlug: string | null,
    permissions: EntityPermissions,
    grantedBy: string,
    granterOrgRole: OrgRole
  ): Promise<LeanEntityPermission> {
    if (granterOrgRole !== 'OWNER' && granterOrgRole !== 'ADMIN') {
      throw new Error('PERMISSION ERROR: Only OWNER and ADMIN users can manage entity permissions');
    }

    const result = await this.entityPermissionRepository.findOrCreate(
      userId,
      organizationId,
      entityType,
      entitySlug,
      permissions,
      grantedBy
    );

    return result;
  }

  /**
   * Creates or updates multiple entity permissions in one database operation.
   * Every referenced entity is validated before any write is performed.
   */
  async setPermissionsBulk(
    organizationId: string,
    permissionInputs: SetEntityPermissionInput[],
    removePermissionIds: string[],
    grantedBy: string,
    granterOrgRole: OrgRole | null,
    isGlobalAdmin = false
  ): Promise<BulkSetEntityPermissionsResult> {
    if (!isGlobalAdmin && granterOrgRole !== 'OWNER' && granterOrgRole !== 'ADMIN') {
      throw new Error('PERMISSION ERROR: Only OWNER and ADMIN users can manage entity permissions');
    }

    const normalizedInputs = permissionInputs.map((input) => ({
      ...input,
      entitySlug: input.entitySlug ?? null,
      permissions: {
        GET: input.permissions.GET ?? false,
        PUT: input.permissions.PUT ?? false,
        DELETE: input.permissions.DELETE ?? false,
        CREATE: input.permissions.CREATE ?? false,
      },
    }));

    return this.entityPermissionRepository.upsertMany(
      organizationId,
      normalizedInputs,
      grantedBy,
      removePermissionIds
    );
  }

  /**
   * Grants entity permissions without role verification. Internal use only.
   * Used by services to auto-grant permissions (e.g., MEMBER creating a pricing).
   */
  async grantEntityPermission(
    userId: string,
    organizationId: string,
    entityType: EntityType,
    entitySlug: string,
    permissions: EntityPermissions
  ): Promise<LeanEntityPermission> {
    return this.entityPermissionRepository.findOrCreate(
      userId,
      organizationId,
      entityType,
      entitySlug,
      permissions
    );
  }

  /**
   * Removes a permission by ID. Only OWNER/ADMIN can call this.
   */
  async removePermission(permissionId: string, granterOrgRole: OrgRole): Promise<boolean> {
    if (granterOrgRole !== 'OWNER' && granterOrgRole !== 'ADMIN') {
      throw new Error('PERMISSION ERROR: Only OWNER and ADMIN users can manage entity permissions');
    }

    return this.entityPermissionRepository.destroy(permissionId);
  }

  /**
   * Gets all entity permissions for an organization.
   * OWNER/ADMIN users receive implicit full permissions for each entity type
   * (org-scoped, entitySlug=null) when no explicit record exists.
   */
  async getOrganizationPermissions(
    organizationId: string,
    entityType?: EntityType,
    userId?: string,
    isGlobalAdmin?: boolean,
    actingRole?: OrgRole | null
  ): Promise<LeanEntityPermission[]> {
    const permissions = await this.entityPermissionRepository.findByOrganization(organizationId, entityType);

    if (!userId) return permissions;

    const orgRole = actingRole !== undefined ? actingRole : await this.resolveOrgRole(userId, organizationId);

    // The records name the private pricings and collections and who may see
    // them: a plain member gets their own only.
    if (!isGlobalAdmin && orgRole !== 'OWNER' && orgRole !== 'ADMIN') {
      return permissions.filter(permission => String(permission._userId) === String(userId));
    }

    if (isGlobalAdmin || orgRole === 'OWNER' || orgRole === 'ADMIN') {
      const types: EntityType[] = entityType ? [entityType] : ['pricing', 'collection'];
      for (const type of types) {
        const existing = permissions.find(
          p => p.entitySlug === null && p.entityType === type && p._userId?.toString() === userId
        );
        if (!existing) {
          permissions.push({
            _userId: userId,
            _organizationId: organizationId,
            entityType: type,
            entitySlug: null,
            permissions: { ...FULL_PERMISSIONS },
          } as LeanEntityPermission);
        }
      }
    }

    return permissions;
  }

  /**
   * Gets all pricings accessible to a user across all their organizations,
   * with effective permissions included.
   */
  async getUserAccessiblePricings(
    userId: string,
    queryParams: PricingIndexQueryParams,
    reqUser?: LeanUser
  ): Promise<{ pricings: any[]; total: number }> {
    const memberships = await this.organizationMembershipRepository.findByUserId(userId, true);
    const orgIds = memberships.map((m: any) => m._organizationId?.toString() ?? m._organizationId);

    if (orgIds.length === 0) {
      return { pricings: [], total: 0 };
    }

    const allPricings: any[] = [];

    for (const orgId of orgIds) {
      const membership = memberships.find((m: any) => (m._organizationId?.toString() ?? m._organizationId) === orgId);
      const orgRole = membership?.role as OrgRole | undefined;
      const isOwnerOrAdmin = reqUser?.role === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'ADMIN';

      const orgQueryParams: PricingIndexQueryParams = {
        ...queryParams,
        selectedOrganizations: [orgId],
      };

      const orgPermissionsContext: OrgUserPermissionsContext = reqUser
        ? await this.buildOrgUserPermissionsContext(reqUser, orgRole ?? null, orgId)
        : {
            orgRole: null,
            pricings: [],
            collections: [],
            isGlobalAdmin: false,
            adminOrgIds: [],
          };

      const result = await this.pricingRepository.findAll(orgQueryParams, orgPermissionsContext);

      if (result && result.pricings) {
        for (const pricing of result.pricings) {
          const entitySlug = pricing.slug;
          if (!entitySlug) continue;
          const permissions = await this.getEffectivePermissions(
            userId,
            orgId,
            'pricing',
            entitySlug,
            orgRole
          );

          if (isOwnerOrAdmin || !pricing.private || permissions.GET) {
            allPricings.push({
              ...pricing,
              permissions,
              organization: { ...pricing.organization, id: orgId, role: orgRole },
            });
          }
        }
      }
    }

    if (queryParams.name) {
      const nameFilter = queryParams.name.toLowerCase();
      const filtered = allPricings.filter((p: any) => p.name?.toLowerCase().includes(nameFilter));
      return { pricings: filtered, total: filtered.length };
    }

    const sortBy = queryParams.sortBy || 'name';
    const sortDir = queryParams.sort === 'asc' ? 1 : -1;
    allPricings.sort((a: any, b: any) => {
      const aVal = a[sortBy] ?? a.name ?? '';
      const bVal = b[sortBy] ?? b.name ?? '';
      if (typeof aVal === 'string') return aVal.localeCompare(bVal) * sortDir;
      return ((aVal as number) - (bVal as number)) * sortDir;
    });

    const offset = queryParams.offset || 0;
    const limit = queryParams.limit || 10;
    const paginated = allPricings.slice(offset, offset + limit);

    return { pricings: paginated, total: allPricings.length };
  }

  /**
   * Gets all collections accessible to a user across all their organizations,
   * with effective permissions included.
   */
  async getUserAccessibleCollections(
    userId: string,
    queryParams: CollectionIndexQueryParams,
    reqUser?: LeanUser
  ): Promise<{ collections: any[]; total: number }> {
    const memberships = await this.organizationMembershipRepository.findByUserId(userId, true);
    const orgIds = memberships.map((m: any) => m._organizationId?.toString() ?? m._organizationId);

    if (orgIds.length === 0) {
      return { collections: [], total: 0 };
    }

    const allCollections: any[] = [];

    for (const orgId of orgIds) {
      const membership = memberships.find((m: any) => (m._organizationId?.toString() ?? m._organizationId) === orgId);
      const orgRole = membership?.role as OrgRole | undefined;
      const isOwnerOrAdmin = reqUser?.role === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'ADMIN';

      const orgQueryParams: CollectionIndexQueryParams = {
        ...queryParams,
        organizationIds: [orgId],
      };

      const orgPermissionsContext: OrgUserPermissionsContext = reqUser
        ? await this.buildOrgUserPermissionsContext(reqUser, orgRole ?? null, orgId)
        : {
            orgRole: null,
            pricings: [],
            collections: [],
            isGlobalAdmin: false,
            adminOrgIds: [],
          };

      const result = await this.pricingCollectionRepository.findAll(orgQueryParams, orgPermissionsContext);

      if (result && result.collections) {
        for (const collection of result.collections) {
          const entitySlug = (collection as any).slug;
          if (!entitySlug) continue;
          const permissions = await this.getEffectivePermissions(
            userId,
            orgId,
            'collection',
            entitySlug,
            orgRole
          );

          if (isOwnerOrAdmin || !(collection as any).private || permissions.GET) {
            allCollections.push({
              ...collection,
              permissions,
              organization: { ...(collection as any).organization, id: orgId, role: orgRole },
            });
          }
        }
      }
    }

    if (queryParams.name) {
      const nameFilter = queryParams.name.toLowerCase();
      const filtered = allCollections.filter((c: any) => c.name?.toLowerCase().includes(nameFilter));
      return { collections: filtered, total: filtered.length };
    }

    allCollections.sort((a: any, b: any) => {
      const aVal = a.name ?? '';
      const bVal = b.name ?? '';
      return aVal.localeCompare(bVal);
    });

    const offset = queryParams.offset || 0;
    const limit = queryParams.limit || 10;
    const paginated = allCollections.slice(offset, offset + limit);

    return { collections: paginated, total: allCollections.length };
  }

  /**
   * Gets effective permissions for the current user on a specific pricing.
   */
  async getPricingPermissions(
    userId: string,
    organizationId: string,
    pricingSlug: string,
    userOrgRole?: OrgRole | null,
    reqUser?: LeanUser
  ): Promise<EntityPermissions> {
    const pricing = await this.pricingRepository.findBySlugAndOrganization(pricingSlug, organizationId);
    // A pricing whose versions are all private, to someone who may not read
    // them, answers like one that does not exist.
    if (!pricing || (reqUser && !(await this.pricingRepository.hasPublicVersion(pricingSlug, organizationId)) &&
      !(await this.canReadPrivateVersions(reqUser, {
        organizationId,
        slug: pricingSlug,
        collectionSlug: await this.pricingCollectionRepository.findSlugById(pricing._collectionId),
      })))) {
      throw new Error('NOT FOUND: Pricing not found');
    }

    const isOwnerOrAdmin = userOrgRole === 'OWNER' || userOrgRole === 'ADMIN';
    if (isOwnerOrAdmin) {
      return { ...FULL_PERMISSIONS };
    }
    const permissions = await this.getEffectivePermissions(
      userId,
      organizationId,
      'pricing',
      pricingSlug,
      userOrgRole
    );

    return permissions;
  }

  /**
   * Gets effective permissions for the current user on a specific collection.
   */
  async getCollectionPermissions(
    userId: string,
    organizationId: string,
    collectionSlug: string,
    userOrgRole?: OrgRole | null
  ): Promise<EntityPermissions> {
    const collection = await this.pricingCollectionRepository.findByOrganizationAndSlug(
      organizationId,
      collectionSlug
    );
    if (!collection) {
      throw new Error('NOT FOUND: Collection not found');
    }

    const isOwnerOrAdmin = userOrgRole === 'OWNER' || userOrgRole === 'ADMIN';
    if (isOwnerOrAdmin) {
      return { ...FULL_PERMISSIONS };
    }
    const permissions = await this.getEffectivePermissions(
      userId,
      organizationId,
      'collection',
      collectionSlug,
      userOrgRole
    );

    return permissions;
  }
}

export default PermissionService;
