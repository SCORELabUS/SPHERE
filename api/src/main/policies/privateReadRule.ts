import { PermissionEngine } from './PermissionEngine';
import { EntityPermissions, EntityType } from '../types/models/EntityPermission';
import { OrgRole } from '../types/models/Organization';

/** How a caller acts in one organization once its API key, if any, is applied. */
export type ActingAccess = { reachable: boolean; role: OrgRole | null; isGlobalAdmin: boolean };

/** Whether the caller may read a private pricing's versions or a private collection of one organization. */
export type PrivateReader = (entityType: EntityType, slug: string, collectionSlug?: string | null) => boolean;

/** Where the rule reads roles, permissions and the organization tree from. */
export interface PrivateReadSources {
  resolveOrgRole(userId: string, organizationId: string): Promise<OrgRole | null>;
  buildBatchContext(
    userId: string,
    organizationId: string,
    userOrgRole?: OrgRole | null,
    isGlobalAdmin?: boolean
  ): Promise<{ entityPermissions: Map<string, EntityPermissions> }>;
  findOrganization(organizationId: string): Promise<{ ancestors?: unknown[] } | null>;
}

type Caller = { id: string; role?: string; apiKey?: { scopes?: Array<{ organizationId: unknown; scope: string }> } };

/**
 * How a caller acts in an organization. With a token it is the user's role
 * (inherited roles included), and a global ADMIN is one. With an API key the
 * key must reach the organization (a scope on it, or ALL on an organization
 * above it): a VIEW scope acts as a plain MEMBER, MANAGEMENT at most as an
 * ADMIN, and the global ADMIN bypass does not apply. A key never makes its
 * user a member of an organization.
 *
 * `authType` is the request's (`req.authType`); without it, a caller that
 * carries `apiKey` (set only when authenticating with a key) is taken as a key.
 */
export async function actingAccess(
  sources: PrivateReadSources,
  caller: Caller | undefined,
  organizationId: string,
  authType?: string
): Promise<ActingAccess> {
  if (!caller) return { reachable: false, role: null, isGlobalAdmin: false };
  const role = await sources.resolveOrgRole(caller.id, organizationId);
  const viaKey = authType ? authType === 'api-key' : Boolean(caller.apiKey);
  if (!viaKey) return { reachable: true, role, isGlobalAdmin: caller.role === 'ADMIN' };

  const organization = await sources.findOrganization(organizationId).catch(() => null);
  const ancestors = (organization?.ancestors ?? []).map(id => String(id));
  const scope = (caller.apiKey?.scopes ?? []).find(entry =>
    String(entry.organizationId) === organizationId ||
    (entry.scope === 'ALL' && ancestors.includes(String(entry.organizationId)))
  );
  if (!scope) return { reachable: false, role: null, isGlobalAdmin: false };
  let acting: OrgRole | null = role;
  if (role && scope.scope === 'VIEW') acting = 'MEMBER';
  else if (role === 'OWNER' && scope.scope === 'MANAGEMENT') acting = 'ADMIN';
  return { reachable: true, role: acting, isGlobalAdmin: false };
}

/**
 * The rule for private versions and private collections, first written for
 * private permanent links: OWNER/ADMIN of the organization, a global ADMIN
 * with a token, or an explicit GET on the pricing or its collection (or on
 * the collection itself), with API keys limited as `actingAccess` says,
 * evaluated with `PermissionEngine`. Permissions count only while their user
 * belongs to the organization. Built once per organization, so a listing can
 * ask it for many entities.
 */
export async function privateReader(
  sources: PrivateReadSources,
  caller: Caller | undefined,
  organizationId: string,
  authType?: string
): Promise<PrivateReader> {
  const access = await actingAccess(sources, caller, organizationId, authType);
  if (!caller || !access.reachable || (!access.role && !access.isGlobalAdmin)) return () => false;
  const batch = await sources.buildBatchContext(caller.id, organizationId, access.role, access.isGlobalAdmin);
  const engine = new PermissionEngine();
  return (entityType, slug, collectionSlug) => {
    const inherited = entityType === 'pricing' && collectionSlug ? collectionSlug : undefined;
    return engine.evaluate({
      userId: caller.id,
      organizationId,
      entityType,
      entitySlug: slug,
      action: 'GET',
      isPrivate: true,
      userOrgRole: access.role,
      isGlobalAdmin: access.isGlobalAdmin,
      collectionSlug: inherited,
      collectionPermissions: inherited ? batch.entityPermissions.get(`collection:${inherited}`) : undefined,
      entityPermissions: batch.entityPermissions.get(`${entityType}:${slug}`),
    }).allowed;
  };
}
