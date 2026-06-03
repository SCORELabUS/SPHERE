import { describe, it, expect } from 'vitest';
import { PermissionEngine } from '../../main/policies/PermissionEngine';
import { PermissionContext } from '../../main/types/policies';
import { EntityPermissions } from '../../main/types/models/EntityPermission';

const engine = new PermissionEngine();

const FULL_PERMS: EntityPermissions = { GET: true, PUT: true, DELETE: true, CREATE: true };
const NO_PERMS: EntityPermissions = { GET: false, PUT: false, DELETE: false, CREATE: false };
const GET_ONLY: EntityPermissions = { GET: true, PUT: false, DELETE: false, CREATE: false };
const GET_PUT: EntityPermissions = { GET: true, PUT: true, DELETE: false, CREATE: false };

function baseCtx(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    userId: 'user1',
    organizationId: 'org1',
    entityType: 'pricing',
    entityId: 'pricing1',
    action: 'GET',
    ...overrides,
  };
}

describe('PermissionEngine', () => {
  describe('Global ADMIN bypass', () => {
    it('allows all actions for global admin', () => {
      const actions = ['GET', 'PUT', 'DELETE', 'CREATE'] as const;
      for (const action of actions) {
        const result = engine.evaluate(baseCtx({
          action,
          isGlobalAdmin: true,
          isPrivate: true,
          entityPermissions: NO_PERMS,
          orgPermissions: NO_PERMS,
        }));
        expect(result.allowed).toBe(true);
      }
    });
  });

  describe('Organization OWNER/ADMIN access', () => {
    it('allows all actions for OWNER', () => {
      const actions = ['GET', 'PUT', 'DELETE', 'CREATE'] as const;
      for (const action of actions) {
        const result = engine.evaluate(baseCtx({
          action,
          userOrgRole: 'OWNER',
          isPrivate: true,
          entityPermissions: NO_PERMS,
          orgPermissions: NO_PERMS,
        }));
        expect(result.allowed).toBe(true);
      }
    });

    it('allows all actions for ADMIN', () => {
      const actions = ['GET', 'PUT', 'DELETE', 'CREATE'] as const;
      for (const action of actions) {
        const result = engine.evaluate(baseCtx({
          action,
          userOrgRole: 'ADMIN',
          isPrivate: true,
          entityPermissions: NO_PERMS,
          orgPermissions: NO_PERMS,
        }));
        expect(result.allowed).toBe(true);
      }
    });
  });

  describe('Organization-level CREATE', () => {
    it('allows MEMBER with CREATE permission', () => {
      const result = engine.evaluate(baseCtx({
        action: 'CREATE',
        userOrgRole: 'MEMBER',
        orgPermissions: FULL_PERMS,
      }));
      expect(result.allowed).toBe(true);
    });

    it('denies MEMBER without CREATE permission', () => {
      const result = engine.evaluate(baseCtx({
        action: 'CREATE',
        userOrgRole: 'MEMBER',
        orgPermissions: NO_PERMS,
      }));
      expect(result.allowed).toBe(false);
    });

    it('denies MEMBER with no org permissions', () => {
      const result = engine.evaluate(baseCtx({
        action: 'CREATE',
        userOrgRole: 'MEMBER',
        orgPermissions: undefined,
      }));
      expect(result.allowed).toBe(false);
    });
  });

  describe('Entity GET - Public entities', () => {
    it('allows GET on public entity', () => {
      const result = engine.evaluate(baseCtx({
        action: 'GET',
        isPrivate: false,
        userOrgRole: 'MEMBER',
      }));
      expect(result.allowed).toBe(true);
    });
  });

  describe('Entity GET - Private entities', () => {
    it('allows GET with explicit permission', () => {
      const result = engine.evaluate(baseCtx({
        action: 'GET',
        isPrivate: true,
        userOrgRole: 'MEMBER',
        entityPermissions: GET_ONLY,
      }));
      expect(result.allowed).toBe(true);
    });

    it('denies GET without explicit permission', () => {
      const result = engine.evaluate(baseCtx({
        action: 'GET',
        isPrivate: true,
        userOrgRole: 'MEMBER',
        entityPermissions: NO_PERMS,
      }));
      expect(result.allowed).toBe(false);
    });

    it('denies GET with no permissions set', () => {
      const result = engine.evaluate(baseCtx({
        action: 'GET',
        isPrivate: true,
        userOrgRole: 'MEMBER',
        entityPermissions: undefined,
      }));
      expect(result.allowed).toBe(false);
    });
  });

  describe('Collection → Pricing inheritance', () => {
    it('allows GET on pricing when collection has GET permission', () => {
      const result = engine.evaluate(baseCtx({
        action: 'GET',
        entityType: 'pricing',
        entitySlug: 'pricing1',
        isPrivate: true,
        userOrgRole: 'MEMBER',
        entityPermissions: NO_PERMS, // No direct permission on pricing
        collectionSlug: 'col1',
        collectionPermissions: GET_ONLY, // But collection has GET
      }));
      expect(result.allowed).toBe(true);
    });

    it('denies GET on pricing when collection has no GET permission', () => {
      const result = engine.evaluate(baseCtx({
        action: 'GET',
        entityType: 'pricing',
        entitySlug: 'pricing1',
        isPrivate: true,
        userOrgRole: 'MEMBER',
        entityPermissions: NO_PERMS,
        collectionSlug: 'col1',
        collectionPermissions: NO_PERMS,
      }));
      expect(result.allowed).toBe(false);
    });

    it('allows GET on pricing with direct permission even without collection', () => {
      const result = engine.evaluate(baseCtx({
        action: 'GET',
        entityType: 'pricing',
        entitySlug: 'pricing1',
        isPrivate: true,
        userOrgRole: 'MEMBER',
        entityPermissions: GET_ONLY,
        collectionId: undefined,
        collectionPermissions: undefined,
      }));
      expect(result.allowed).toBe(true);
    });
  });

  describe('Entity PUT', () => {
    it('allows PUT with GET and PUT permissions', () => {
      const result = engine.evaluate(baseCtx({
        action: 'PUT',
        userOrgRole: 'MEMBER',
        entityPermissions: GET_PUT,
      }));
      expect(result.allowed).toBe(true);
    });

    it('denies PUT without PUT permission', () => {
      const result = engine.evaluate(baseCtx({
        action: 'PUT',
        userOrgRole: 'MEMBER',
        entityPermissions: GET_ONLY,
      }));
      expect(result.allowed).toBe(false);
    });

    it('denies PUT on private entity without GET permission', () => {
      const result = engine.evaluate(baseCtx({
        action: 'PUT',
        isPrivate: true,
        userOrgRole: 'MEMBER',
        entityPermissions: { GET: false, PUT: true, DELETE: false, CREATE: false },
      }));
      expect(result.allowed).toBe(false);
    });

    it('allows PUT on private entity with GET and PUT permissions', () => {
      const result = engine.evaluate(baseCtx({
        action: 'PUT',
        isPrivate: true,
        userOrgRole: 'MEMBER',
        entityPermissions: GET_PUT,
      }));
      expect(result.allowed).toBe(true);
    });
  });

  describe('Entity DELETE', () => {
    it('allows DELETE with DELETE permission', () => {
      const result = engine.evaluate(baseCtx({
        action: 'DELETE',
        userOrgRole: 'MEMBER',
        entityPermissions: { GET: false, PUT: false, DELETE: true, CREATE: false },
      }));
      expect(result.allowed).toBe(true);
    });

    it('denies DELETE without DELETE permission', () => {
      const result = engine.evaluate(baseCtx({
        action: 'DELETE',
        userOrgRole: 'MEMBER',
        entityPermissions: GET_PUT,
      }));
      expect(result.allowed).toBe(false);
    });
  });

  describe('Default deny', () => {
    it('denies when no policy matches', () => {
      // Use an action that no policy handles (not GET, PUT, DELETE, CREATE)
      const result = engine.evaluate(baseCtx({
        action: 'PATCH' as any,
        userOrgRole: 'MEMBER',
        entityPermissions: undefined,
      }));
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No matching policy found');
    });
  });

  describe('evaluateBatch', () => {
    it('evaluates multiple contexts correctly', () => {
      const contexts = [
        {
          key: 'public-pricing',
          context: baseCtx({
            entityId: 'pricing1',
            isPrivate: false,
            userOrgRole: 'MEMBER',
          }),
        },
        {
          key: 'private-pricing-with-perm',
          context: baseCtx({
            entityId: 'pricing2',
            isPrivate: true,
            userOrgRole: 'MEMBER',
            entityPermissions: GET_ONLY,
          }),
        },
        {
          key: 'private-pricing-no-perm',
          context: baseCtx({
            entityId: 'pricing3',
            isPrivate: true,
            userOrgRole: 'MEMBER',
            entityPermissions: NO_PERMS,
          }),
        },
      ];

      const results = engine.evaluateBatch(contexts);

      expect(results.get('public-pricing')?.allowed).toBe(true);
      expect(results.get('private-pricing-with-perm')?.allowed).toBe(true);
      expect(results.get('private-pricing-no-perm')?.allowed).toBe(false);
    });

    it('enriches context with batch data', () => {
      const batchContext = {
        userId: 'user1',
        organizationId: 'org1',
        userOrgRole: 'MEMBER' as const,
        isGlobalAdmin: false,
        orgPermissions: new Map(),
        entityPermissions: new Map([
          ['pricing:pricing1', GET_ONLY],
        ]),
        collectionPermissions: new Map(),
      };

      const contexts = [
        {
          key: 'pricing1',
          context: baseCtx({
            entitySlug: 'pricing1',
            isPrivate: true,
            userOrgRole: undefined,
            isGlobalAdmin: undefined,
          }),
        },
      ];

      const results = engine.evaluateBatch(contexts, { batchContext });

      expect(results.get('pricing1')?.allowed).toBe(true);
    });
  });
});
