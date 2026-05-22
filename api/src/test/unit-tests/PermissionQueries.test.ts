import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EntityPermissions, LeanEntityPermission } from '../../main/types/models/EntityPermission';

const { mockEntityPermRepo, mockOrgMemberRepo } = vi.hoisted(() => ({
  mockEntityPermRepo: {
    findByUserAndOrgScopedType: vi.fn(),
    findByUserAndOrganization: vi.fn(),
    findByUser: vi.fn(),
  },
  mockOrgMemberRepo: {
    findUserRoleInOrganization: vi.fn(),
    findRolesByUserId: vi.fn(),
  },
}));

vi.mock('../../main/config/container', () => ({
  default: {
    resolve: (name: string) => {
      if (name === 'entityPermissionRepository') return mockEntityPermRepo;
      if (name === 'organizationMembershipRepository') return mockOrgMemberRepo;
      throw new Error(`Unknown dependency: ${name}`);
    },
  },
}));

import { PermissionQueries } from '../../main/policies/queries/PermissionQueries';

function makePerm(overrides: Partial<LeanEntityPermission> & { entityType: string }): LeanEntityPermission {
  return {
    id: 'perm_' + Math.random().toString(36).slice(2, 8),
    _userId: 'user1',
    _organizationId: 'org1',
    entityId: null,
    permissions: { GET: true, PUT: false, DELETE: false, CREATE: false },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LeanEntityPermission;
}

describe('PermissionQueries', () => {
  let queries: PermissionQueries;

  beforeEach(() => {
    vi.clearAllMocks();
    queries = new PermissionQueries();
  });

  describe('buildBatchContext', () => {
    it('returns a BatchEvaluationContext with correct structure', async () => {
      mockEntityPermRepo.findByUserAndOrgScopedType.mockResolvedValue(null);
      mockEntityPermRepo.findByUserAndOrganization.mockResolvedValue([]);

      const ctx = await queries.buildBatchContext('user1', 'org1', 'MEMBER', false);

      expect(ctx.userId).toBe('user1');
      expect(ctx.organizationId).toBe('org1');
      expect(ctx.userOrgRole).toBe('MEMBER');
      expect(ctx.isGlobalAdmin).toBe(false);
      expect(ctx.orgPermissions).toBeInstanceOf(Map);
      expect(ctx.entityPermissions).toBeInstanceOf(Map);
      expect(ctx.collectionPermissions).toBeInstanceOf(Map);
    });

    it('populates orgPermissions from org-scoped records', async () => {
      mockEntityPermRepo.findByUserAndOrgScopedType.mockImplementation(
        async (_userId: string, _orgId: string, entityType: string) => {
          if (entityType === 'pricing') {
            return { permissions: { GET: true, PUT: true, DELETE: false, CREATE: true } };
          }
          return null;
        }
      );
      mockEntityPermRepo.findByUserAndOrganization.mockResolvedValue([]);

      const ctx = await queries.buildBatchContext('user1', 'org1');

      expect(ctx.orgPermissions.get('pricing')).toEqual({ GET: true, PUT: true, DELETE: false, CREATE: true });
      expect(ctx.orgPermissions.has('collection')).toBe(false);
    });

    it('populates entityPermissions from entity-level records', async () => {
      mockEntityPermRepo.findByUserAndOrgScopedType.mockResolvedValue(null);
      mockEntityPermRepo.findByUserAndOrganization.mockResolvedValue([
        makePerm({ entityType: 'pricing', entityId: 'p1', permissions: { GET: true, PUT: true, DELETE: false, CREATE: false } }),
        makePerm({ entityType: 'collection', entityId: 'c1', permissions: { GET: true, PUT: false, DELETE: false, CREATE: false } }),
      ]);

      const ctx = await queries.buildBatchContext('user1', 'org1');

      expect(ctx.entityPermissions.get('pricing:p1')).toEqual({ GET: true, PUT: true, DELETE: false, CREATE: false });
      expect(ctx.entityPermissions.get('collection:c1')).toEqual({ GET: true, PUT: false, DELETE: false, CREATE: false });
    });

    it('extracts collectionPermissions from collection entity records', async () => {
      mockEntityPermRepo.findByUserAndOrgScopedType.mockResolvedValue(null);
      mockEntityPermRepo.findByUserAndOrganization.mockResolvedValue([
        makePerm({ entityType: 'collection', entityId: 'c1', permissions: { GET: true, PUT: true, DELETE: false, CREATE: false } }),
        makePerm({ entityType: 'pricing', entityId: 'p1', permissions: { GET: true, PUT: false, DELETE: false, CREATE: false } }),
      ]);

      const ctx = await queries.buildBatchContext('user1', 'org1');

      expect(ctx.collectionPermissions.get('c1')).toEqual({ GET: true, PUT: true, DELETE: false, CREATE: false });
      expect(ctx.collectionPermissions.has('p1')).toBe(false);
    });

    it('skips entity records with null entityId', async () => {
      mockEntityPermRepo.findByUserAndOrgScopedType.mockResolvedValue(null);
      mockEntityPermRepo.findByUserAndOrganization.mockResolvedValue([
        makePerm({ entityType: 'pricing', entityId: null }),
        makePerm({ entityType: 'pricing', entityId: 'p1' }),
      ]);

      const ctx = await queries.buildBatchContext('user1', 'org1');

      expect(ctx.entityPermissions.size).toBe(1);
      expect(ctx.entityPermissions.has('pricing:p1')).toBe(true);
    });
  });

  describe('buildAllOrgsBatchContext', () => {
    it('returns empty map when user has no org memberships', async () => {
      mockOrgMemberRepo.findRolesByUserId.mockResolvedValue(new Map());
      mockEntityPermRepo.findByUser.mockResolvedValue([]);

      const ctx = await queries.buildAllOrgsBatchContext('user1');

      expect(ctx).toBeInstanceOf(Map);
      expect(ctx.size).toBe(0);
    });

    it('builds context for each organization the user belongs to', async () => {
      const orgRoles = new Map([['org1', 'OWNER'], ['org2', 'MEMBER']]);
      mockOrgMemberRepo.findRolesByUserId.mockResolvedValue(orgRoles);
      mockEntityPermRepo.findByUser.mockResolvedValue([]);

      const ctx = await queries.buildAllOrgsBatchContext('user1');

      expect(ctx.size).toBe(2);
      expect(ctx.get('org1')?.userOrgRole).toBe('OWNER');
      expect(ctx.get('org2')?.userOrgRole).toBe('MEMBER');
    });

    it('groups entity permissions by organization', async () => {
      const orgRoles = new Map([['org1', 'ADMIN'], ['org2', 'MEMBER']]);
      mockOrgMemberRepo.findRolesByUserId.mockResolvedValue(orgRoles);
      mockEntityPermRepo.findByUser.mockResolvedValue([
        makePerm({ _organizationId: 'org1', entityType: 'pricing', entityId: 'p1', permissions: { GET: true, PUT: true, DELETE: false, CREATE: false } }),
        makePerm({ _organizationId: 'org1', entityType: 'collection', entityId: 'c1', permissions: { GET: true, PUT: false, DELETE: false, CREATE: false } }),
        makePerm({ _organizationId: 'org2', entityType: 'pricing', entityId: 'p2', permissions: { GET: true, PUT: false, DELETE: false, CREATE: false } }),
      ]);

      const ctx = await queries.buildAllOrgsBatchContext('user1');

      expect(ctx.get('org1')?.entityPermissions.size).toBe(2);
      expect(ctx.get('org1')?.entityPermissions.get('pricing:p1')).toBeDefined();
      expect(ctx.get('org1')?.entityPermissions.get('collection:c1')).toBeDefined();
      expect(ctx.get('org2')?.entityPermissions.size).toBe(1);
      expect(ctx.get('org2')?.entityPermissions.get('pricing:p2')).toBeDefined();
    });

    it('handles org-scoped permissions (entityId=null) correctly', async () => {
      const orgRoles = new Map([['org1', 'MEMBER']]);
      mockOrgMemberRepo.findRolesByUserId.mockResolvedValue(orgRoles);
      mockEntityPermRepo.findByUser.mockResolvedValue([
        makePerm({ _organizationId: 'org1', entityType: 'pricing', entityId: null, permissions: { GET: true, PUT: true, DELETE: true, CREATE: true } }),
        makePerm({ _organizationId: 'org1', entityType: 'pricing', entityId: 'p1' }),
      ]);

      const ctx = await queries.buildAllOrgsBatchContext('user1');
      const org1 = ctx.get('org1')!;

      expect(org1.orgPermissions.get('pricing')).toEqual({ GET: true, PUT: true, DELETE: true, CREATE: true });
      expect(org1.entityPermissions.size).toBe(1);
      expect(org1.entityPermissions.has('pricing:p1')).toBe(true);
    });

    it('extracts collectionPermissions per organization', async () => {
      const orgRoles = new Map([['org1', 'MEMBER'], ['org2', 'MEMBER']]);
      mockOrgMemberRepo.findRolesByUserId.mockResolvedValue(orgRoles);
      mockEntityPermRepo.findByUser.mockResolvedValue([
        makePerm({ _organizationId: 'org1', entityType: 'collection', entityId: 'c1', permissions: { GET: true, PUT: true, DELETE: false, CREATE: false } }),
        makePerm({ _organizationId: 'org2', entityType: 'collection', entityId: 'c2', permissions: { GET: false, PUT: false, DELETE: false, CREATE: false } }),
      ]);

      const ctx = await queries.buildAllOrgsBatchContext('user1');

      expect(ctx.get('org1')?.collectionPermissions.get('c1')).toEqual({ GET: true, PUT: true, DELETE: false, CREATE: false });
      expect(ctx.get('org2')?.collectionPermissions.get('c2')).toEqual({ GET: false, PUT: false, DELETE: false, CREATE: false });
      expect(ctx.get('org1')?.collectionPermissions.has('c2')).toBe(false);
      expect(ctx.get('org2')?.collectionPermissions.has('c1')).toBe(false);
    });

    it('creates empty context for orgs with no permissions', async () => {
      const orgRoles = new Map([['org1', 'MEMBER'], ['org2', 'MEMBER']]);
      mockOrgMemberRepo.findRolesByUserId.mockResolvedValue(orgRoles);
      mockEntityPermRepo.findByUser.mockResolvedValue([
        makePerm({ _organizationId: 'org1', entityType: 'pricing', entityId: 'p1' }),
      ]);

      const ctx = await queries.buildAllOrgsBatchContext('user1');

      expect(ctx.get('org1')?.entityPermissions.size).toBe(1);
      expect(ctx.get('org2')?.orgPermissions.size).toBe(0);
      expect(ctx.get('org2')?.entityPermissions.size).toBe(0);
      expect(ctx.get('org2')?.collectionPermissions.size).toBe(0);
    });

    it('sets isGlobalAdmin on all contexts', async () => {
      const orgRoles = new Map([['org1', 'MEMBER'], ['org2', 'ADMIN']]);
      mockOrgMemberRepo.findRolesByUserId.mockResolvedValue(orgRoles);
      mockEntityPermRepo.findByUser.mockResolvedValue([]);

      const ctx = await queries.buildAllOrgsBatchContext('user1', true);

      expect(ctx.get('org1')?.isGlobalAdmin).toBe(true);
      expect(ctx.get('org2')?.isGlobalAdmin).toBe(true);
    });

    it('passes userId to all contexts', async () => {
      const orgRoles = new Map([['org1', 'MEMBER']]);
      mockOrgMemberRepo.findRolesByUserId.mockResolvedValue(orgRoles);
      mockEntityPermRepo.findByUser.mockResolvedValue([]);

      const ctx = await queries.buildAllOrgsBatchContext('user1');

      expect(ctx.get('org1')?.userId).toBe('user1');
    });

    it('only makes 2 DB queries regardless of org count', async () => {
      const orgRoles = new Map([
        ['org1', 'OWNER'],
        ['org2', 'ADMIN'],
        ['org3', 'MEMBER'],
        ['org4', 'MEMBER'],
        ['org5', 'MEMBER'],
      ]);
      mockOrgMemberRepo.findRolesByUserId.mockResolvedValue(orgRoles);
      mockEntityPermRepo.findByUser.mockResolvedValue([]);

      await queries.buildAllOrgsBatchContext('user1');

      expect(mockOrgMemberRepo.findRolesByUserId).toHaveBeenCalledTimes(1);
      expect(mockEntityPermRepo.findByUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveOrgRole', () => {
    it('returns the role from the repository', async () => {
      mockOrgMemberRepo.findUserRoleInOrganization.mockResolvedValue('ADMIN');

      const role = await queries.resolveOrgRole('user1', 'org1');

      expect(role).toBe('ADMIN');
      expect(mockOrgMemberRepo.findUserRoleInOrganization).toHaveBeenCalledWith('user1', 'org1');
    });

    it('returns null when user has no role', async () => {
      mockOrgMemberRepo.findUserRoleInOrganization.mockResolvedValue(null);

      const role = await queries.resolveOrgRole('user1', 'org1');

      expect(role).toBeNull();
    });
  });
});
