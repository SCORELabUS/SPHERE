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
import { ApiKey, LeanUser } from '../types/models/User';
import { PricingIndexQueryParams } from '../types/services/PricingService';
import { CollectionIndexQueryParams } from '../types/services/PricingCollection';
import { PermissionQueries } from '../policies/queries/PermissionQueries';
import { BatchEvaluationContext, OrgUserPermissionsContext, PrivateCollectionAccess } from '../types/policies';
import { PermissionEngine } from '../policies/PermissionEngine';

/** A collection as the visibility checks need it. A missing `private` is the legacy public value. */
export type CollectionRef = { organizationId: string; slug: string; private?: boolean | null };

/** How a caller acts in one organization once its API key, if any, is applied. */
export type CallerAccess = { reachable: boolean; role: OrgRole | null; isGlobalAdmin: boolean };

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
      collections: collectionsWithGetPermissions,
      collectionsWritable: collectionsWithPutPermissions,
      collectionKeys,
      isGlobalAdmin: reqUser.role === 'ADMIN',
      adminOrgIds,
    };
  }

  /**
   * How a caller acts in an organization, worked out as
   * `PermanentLinkService.authorize` does it. With a token it is the user's own
   * role (inherited roles included) and a global ADMIN is one. With an API key
   * the key must reach the organization (a scope on it, or ALL on an
   * organization above it); a VIEW scope acts as a plain MEMBER, MANAGEMENT at
   * most as an ADMIN, and the global ADMIN bypass does not apply.
   */
  async callerAccess(reqUser: LeanUser | undefined, organizationId: string): Promise<CallerAccess> {
    if (!reqUser) return { reachable: false, role: null, isGlobalAdmin: false };
    let role = await this.resolveOrgRole(reqUser.id, organizationId);
    const apiKey: ApiKey | undefined = (reqUser as any).apiKey;
    if (!apiKey || !Array.isArray(apiKey.scopes)) {
      return { reachable: true, role, isGlobalAdmin: reqUser.role === 'ADMIN' };
    }
    const organization: any = await container.resolve('organizationRepository').findById(organizationId).catch(() => null);
    const ancestors: string[] = (organization?.ancestors ?? []).map((id: any) => String(id));
    const scope = apiKey.scopes.find(entry =>
      String(entry.organizationId) === organizationId ||
      (entry.scope === 'ALL' && ancestors.includes(String(entry.organizationId)))
    );
    if (!scope) return { reachable: false, role: null, isGlobalAdmin: false };
    if (scope.scope === 'VIEW') role = 'MEMBER';
    else if (scope.scope === 'MANAGEMENT' && role === 'OWNER') role = 'ADMIN';
    return { reachable: true, role, isGlobalAdmin: false };
  }

  /**
   * Whether the caller may see a collection: a public one always, a private
   * one by the rule of `GET /collections/{organizationId}/{slug}`
   * (OWNER/ADMIN of its organization, an explicit GET on it, a global ADMIN,
   * an API key only within its scope).
   */
  async canViewCollection(reqUser: LeanUser | undefined, collection: CollectionRef): Promise<boolean> {
    if (collection.private !== true) return true;
    const access = await this.callerAccess(reqUser, collection.organizationId);
    return this.allowsPrivateCollection(reqUser, collection, access);
  }

  private async allowsPrivateCollection(
    reqUser: LeanUser | undefined,
    collection: CollectionRef,
    access: CallerAccess,
    batch?: BatchEvaluationContext
  ): Promise<boolean> {
    if (!reqUser || !access.reachable) return false;
    const context = batch ?? (await this.buildBatchContext(reqUser.id, collection.organizationId, access.role, access.isGlobalAdmin));
    return new PermissionEngine().evaluate({
      userId: reqUser.id,
      organizationId: collection.organizationId,
      entityType: 'collection',
      entitySlug: collection.slug,
      action: 'GET',
      isPrivate: true,
      userOrgRole: access.role,
      isGlobalAdmin: access.isGlobalAdmin,
      entityPermissions: context.entityPermissions.get(`collection:${collection.slug}`),
    }).allowed;
  }

  /**
   * The private collections the caller may see, for listings that must hide the
   * rest. Only organizations the caller belongs to (or sits above) or holds a
   * collection permission in can have any.
   */
  async visiblePrivateCollections(reqUser: LeanUser | undefined): Promise<PrivateCollectionAccess> {
    if (!reqUser) return [];
    const apiKey = (reqUser as any).apiKey;
    if (reqUser.role === 'ADMIN' && !apiKey) return 'all';

    const roles = await this.organizationMembershipRepository.findRolesByUserId(reqUser.id);
    const granted = (await this.entityPermissionRepository.findByUser(reqUser.id))
      .filter(permission => permission.entityType === 'collection' && permission.permissions?.GET)
      .map(permission => String(permission._organizationId));
    const organizationIds = new Set<string>(granted);
    for (const id of await container.resolve('organizationRepository').findIdsWithin([...roles.keys()])) {
      organizationIds.add(id);
    }
    if (organizationIds.size === 0) return [];

    const candidates = await this.pricingCollectionRepository.findPrivateRefsByOrganizationIds([...organizationIds]);
    const perOrganization = new Map<string, { access: CallerAccess; batch?: BatchEvaluationContext }>();
    const visible: string[] = [];
    for (const candidate of candidates) {
      let entry = perOrganization.get(candidate.organizationId);
      if (!entry) {
        const access = await this.callerAccess(reqUser, candidate.organizationId);
        const batch = access.reachable
          ? await this.buildBatchContext(reqUser.id, candidate.organizationId, access.role, access.isGlobalAdmin)
          : undefined;
        entry = { access, batch };
        perOrganization.set(candidate.organizationId, entry);
      }
      if (await this.allowsPrivateCollection(reqUser, { ...candidate, private: true }, entry.access, entry.batch)) {
        visible.push(candidate.id);
      }
    }
    return visible;
  }

  /**
   * Narrows a listing context built from the user's own permissions to what
   * the API key the request came with reaches (see `callerAccess`). A request
   * with a token is left as it is.
   */
  async scopeToApiKey(reqUser: LeanUser, context: OrgUserPermissionsContext): Promise<OrgUserPermissionsContext> {
    if (!(reqUser as any).apiKey) return context;
    const adminOrgIds: string[] = [];
    const reachable = new Set<string>();
    const organizationIds = new Set<string>([
      ...context.adminOrgIds,
      ...[...(context.collectionKeys ?? []), ...(context.collectionsWritable ?? [])].map(key => key.split(':')[0]),
    ]);
    for (const organizationId of organizationIds) {
      const access = await this.callerAccess(reqUser, organizationId);
      if (!access.reachable) continue;
      reachable.add(organizationId);
      if (context.adminOrgIds.includes(organizationId) && (access.role === 'OWNER' || access.role === 'ADMIN')) {
        adminOrgIds.push(organizationId);
      }
    }
    const inReach = (keys?: string[]) => keys?.filter(key => reachable.has(key.split(':')[0]));
    return {
      ...context,
      isGlobalAdmin: false,
      adminOrgIds,
      collectionKeys: inReach(context.collectionKeys),
      // Already `organizationId:slug` when built for every organization of the user.
      collectionsWritable: context.collectionsWritable?.every(key => key.includes(':'))
        ? inReach(context.collectionsWritable)
        : context.collectionsWritable,
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
    isGlobalAdmin?: boolean
  ): Promise<LeanEntityPermission[]> {
    const permissions = await this.entityPermissionRepository.findByOrganization(organizationId, entityType);

    if (!userId) return permissions;

    const orgRole = await this.resolveOrgRole(userId, organizationId);

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
    userOrgRole?: OrgRole | null
  ): Promise<EntityPermissions> {
    const pricing = await this.pricingRepository.findBySlugAndOrganization(pricingSlug, organizationId);
    if (!pricing) {
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
    userOrgRole?: OrgRole | null,
    reqUser?: LeanUser
  ): Promise<EntityPermissions> {
    const collection = await this.pricingCollectionRepository.findByOrganizationAndSlug(
      organizationId,
      collectionSlug
    );
    // A private collection the caller may not see answers like a missing one.
    if (
      !collection ||
      (reqUser && !(await this.canViewCollection(reqUser, { organizationId, slug: collection.slug, private: collection.private })))
    ) {
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
