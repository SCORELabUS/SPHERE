import { Policy } from '../../types/policies';

/**
 * Organization-level policies.
 * These handle CREATE operations and org metadata updates.
 */

const GLOBAL_ADMIN_BYPASS: Policy = {
  name: 'global-admin-bypass',
  description: 'Global SPHERE ADMIN bypasses all organization-level checks',
  evaluate: (ctx) => {
    if (ctx.isGlobalAdmin) {
      return { allowed: true, reason: 'Global admin bypass' };
    }
    return null; // Not applicable, continue to next policy
  },
};

const OWNER_ADMIN_FULL_ACCESS: Policy = {
  name: 'owner-admin-full-access',
  description: 'Organization OWNER and ADMIN have full access to org operations',
  evaluate: (ctx) => {
    if (ctx.userOrgRole === 'OWNER' || ctx.userOrgRole === 'ADMIN') {
      return { allowed: true, reason: `Organization ${ctx.userOrgRole} access` };
    }
    return null;
  },
};

const CREATE_ENTITY: Policy = {
  name: 'create-entity',
  description: 'MEMBER can create entities if they have org-scoped CREATE permission',
  evaluate: (ctx) => {
    if (ctx.action !== 'CREATE') return null;

    // If there's an entitySlug, defer to entity-level policies
    if (ctx.entitySlug) return null;

    // Global ADMIN and OWNER/ADMIN are already handled by previous policies
    if (ctx.userOrgRole === 'MEMBER') {
      if (ctx.orgPermissions?.CREATE) {
        return { allowed: true, reason: 'Org-scoped CREATE permission granted' };
      }
      return { allowed: false, reason: 'MEMBER requires explicit CREATE permission' };
    }

    return null;
  },
};

const MEMBER_READ_ACCESS: Policy = {
  name: 'member-read-access',
  description: 'Any org MEMBER can perform GET on public entities',
  evaluate: (ctx) => {
    if (ctx.action === 'GET' && !ctx.isPrivate) {
      return { allowed: true, reason: 'Public entity access' };
    }
    return null;
  },
};

export const organizationPolicies: Policy[] = [
  GLOBAL_ADMIN_BYPASS,
  OWNER_ADMIN_FULL_ACCESS,
  CREATE_ENTITY,
  MEMBER_READ_ACCESS,
];
