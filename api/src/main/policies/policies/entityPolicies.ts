import { Policy } from '../../types/policies';

/**
 * Entity-level policies.
 * These handle GET/PUT/DELETE on specific pricings and collections.
 * Includes collection → pricing inheritance for GET.
 */

const GLOBAL_ADMIN_ENTITY_BYPASS: Policy = {
  name: 'global-admin-entity-bypass',
  description: 'Global SPHERE ADMIN bypasses all entity-level checks',
  evaluate: (ctx) => {
    if (ctx.isGlobalAdmin) {
      return { allowed: true, reason: 'Global admin entity bypass' };
    }
    return null;
  },
};

const OWNER_ADMIN_ENTITY_FULL_ACCESS: Policy = {
  name: 'owner-admin-entity-full-access',
  description: 'Organization OWNER and ADMIN have full access to all entities',
  evaluate: (ctx) => {
    if (ctx.userOrgRole === 'OWNER' || ctx.userOrgRole === 'ADMIN') {
      return { allowed: true, reason: `Organization ${ctx.userOrgRole} entity access` };
    }
    return null;
  },
};

const PUBLIC_ENTITY_GET: Policy = {
  name: 'public-entity-get',
  description: 'Any authenticated user can GET public entities',
  evaluate: (ctx) => {
    if (ctx.action === 'GET' && !ctx.isPrivate) {
      return { allowed: true, reason: 'Public entity GET access' };
    }
    return null;
  },
};

const PRIVATE_ENTITY_GET: Policy = {
  name: 'private-entity-get',
  description: 'Private entities require explicit GET permission',
  evaluate: (ctx) => {
    if (ctx.action === 'GET' && ctx.isPrivate) {
      if (ctx.entityPermissions?.GET) {
        return { allowed: true, reason: 'Explicit GET permission granted' };
      }
      return { allowed: false, reason: 'Private entity requires explicit GET permission' };
    }
    return null;
  },
};

const COLLECTION_INHERITED_GET: Policy = {
  name: 'collection-inherited-get',
  description: 'Pricing inherits GET permission from its parent collection',
  evaluate: (ctx) => {
    if (ctx.action === 'GET' && ctx.entityType === 'pricing' && ctx.collectionId) {
      // If the pricing has no direct GET permission but has a collection
      if (!ctx.entityPermissions?.GET && ctx.collectionPermissions?.GET) {
        return { allowed: true, reason: 'Inherited GET from parent collection' };
      }
    }
    return null;
  },
};

const ENTITY_POST: Policy = {
  name: 'entity-post',
  description: 'POST on existing entity requires explicit CREATE permission at entity level',
  evaluate: (ctx) => {
    if (ctx.action === 'CREATE' && ctx.entityId) {
      if (ctx.entityPermissions?.CREATE) {
        return { allowed: true, reason: 'Entity-level CREATE permission granted' };
      }
      return { allowed: false, reason: 'Entity-level CREATE permission required' };
    }
    return null;
  },
};

const ENTITY_PUT: Policy = {
  name: 'entity-put',
  description: 'PUT requires both GET (can see) and PUT (can edit) permissions',
  evaluate: (ctx) => {
    if (ctx.action === 'PUT') {
      // For private entities, must have GET first
      if (ctx.isPrivate && !ctx.entityPermissions?.GET) {
        return { allowed: false, reason: 'PUT requires GET permission on private entity' };
      }
      if (ctx.entityPermissions?.PUT) {
        return { allowed: true, reason: 'PUT permission granted' };
      }
      return { allowed: false, reason: 'PUT permission required' };
    }
    return null;
  },
};

const ENTITY_DELETE: Policy = {
  name: 'entity-delete',
  description: 'DELETE requires explicit DELETE permission',
  evaluate: (ctx) => {
    if (ctx.action === 'DELETE') {
      if (ctx.entityPermissions?.DELETE) {
        return { allowed: true, reason: 'DELETE permission granted' };
      }
      return { allowed: false, reason: 'DELETE permission required' };
    }
    return null;
  },
};

export const entityPolicies: Policy[] = [
  GLOBAL_ADMIN_ENTITY_BYPASS,
  OWNER_ADMIN_ENTITY_FULL_ACCESS,
  PUBLIC_ENTITY_GET,
  COLLECTION_INHERITED_GET, // Must come before PRIVATE_ENTITY_GET
  PRIVATE_ENTITY_GET,
  ENTITY_POST,
  ENTITY_PUT,
  ENTITY_DELETE,
];
