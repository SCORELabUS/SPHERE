import { OrgRole } from '../../types/models/Organization';
import { ApiKey } from '../../types/models/User';
import { generateSlug } from '../../utils/slug-manager';

/** The signed-in user ORBIT acts for. */
export interface OrbitActor {
  id: string;
  username: string;
  role: string;
  /**
   * The API key the user came with (the MCP server). Its scopes bound what
   * ORBIT reads for it as they bound the REST API: a VIEW scope acts as a
   * plain MEMBER, MANAGEMENT at most as an ADMIN, and the global ADMIN bypass
   * does not apply (see `policies/privateReadRule.ts`).
   */
  apiKey?: ApiKey;
}

interface RoleSource {
  getUserOrgRole(userId: string, organizationId: string): Promise<OrgRole | null>;
}

/**
 * The role the user holds in an organization, counting the ones inherited from
 * above, exactly as the route guard works it out: a platform administrator
 * answers for every organization as its owner. With an API key, the role the
 * key acts with in that organization (none where it has no scope).
 */
export async function resolveOrgRole(
  organizationService: RoleSource,
  actor: OrbitActor,
  organizationId: string
): Promise<OrgRole | null> {
  if (actor.apiKey) {
    const { default: container } = await import('../../config/container');
    const access = await container.resolve('permissionService').actingAccess(actor as any, organizationId, 'api-key');
    return access.reachable ? access.role : null;
  }
  if (actor.role === 'ADMIN') return 'OWNER';
  return organizationService.getUserOrgRole(actor.id, organizationId);
}

/** Creating children, editing, adding members and inviting all need a manager. */
export function canManage(role: OrgRole | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

const MIN_SLUG_LENGTH = 3;
// Room is left for the suffix the service appends when the name is taken.
const MAX_SLUG_LENGTH = 38;

/**
 * The slug an organization ORBIT creates is stored under. ORBIT is given display
 * names only, so it derives one the create endpoint would accept: accents
 * folded, lowercase, at least three characters.
 */
export function slugForOrganization(displayName: string): string {
  const folded = displayName.normalize('NFD').replace(/[̀-ͯ]/g, '');
  let slug = generateSlug(folded)
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  if (slug.length === 0) slug = 'organization';
  if (slug.length < MIN_SLUG_LENGTH) slug = `${slug}-org`;
  return slug;
}

/**
 * Whether renaming an organization to this display name would go through: the
 * update endpoint rejects names whose slug comes out shorter than three
 * characters.
 */
export function isRenameAllowed(displayName: string): boolean {
  return generateSlug(displayName).length >= MIN_SLUG_LENGTH;
}
