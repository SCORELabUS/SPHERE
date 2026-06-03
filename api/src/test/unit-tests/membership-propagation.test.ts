import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../main/config/container', () => ({
  default: {
    resolve: vi.fn(),
  },
}));

vi.mock('../../main/services/FileService', () => ({
  processFileUris: vi.fn(),
}));

import container from '../../main/config/container';
import OrganizationService from '../../main/services/OrganizationService';

function createMockOrgRepo() {
  return {
    findById: vi.fn(),
    create: vi.fn(),
    findChildOrganizationIds: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    update: vi.fn(),
    destroy: vi.fn(),
    findExistingSlug: vi.fn().mockResolvedValue(false),
  };
}

function createMockMembershipRepo() {
  return {
    create: vi.fn(),
    createBulk: vi.fn(),
    findDirectMemberships: vi.fn(),
    findExistingMembership: vi.fn(),
    findUserRoleInOrganization: vi.fn(),
    findByUserAndOrganization: vi.fn(),
    findByOrganizationId: vi.fn(),
    findByUserId: vi.fn(),
    updateByUserAndOrganization: vi.fn(),
    destroyByUserAndOrganization: vi.fn(),
    destroyByUserAndOrganizationBatch: vi.fn(),
    destroyByOrganizationId: vi.fn(),
    destroyByUserId: vi.fn(),
    countOwners: vi.fn(),
  };
}

function createMockInvitationRepo() {
  return {
    create: vi.fn(),
    findByOrganizationId: vi.fn(),
    findByCode: vi.fn(),
    destroy: vi.fn(),
    incrementUseCount: vi.fn(),
    destroyByOrganizationId: vi.fn(),
  };
}

describe('OrganizationService - Membership Propagation', () => {
  let orgRepo: ReturnType<typeof createMockOrgRepo>;
  let membershipRepo: ReturnType<typeof createMockMembershipRepo>;
  let invitationRepo: ReturnType<typeof createMockInvitationRepo>;
  let service: OrganizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    orgRepo = createMockOrgRepo();
    membershipRepo = createMockMembershipRepo();
    invitationRepo = createMockInvitationRepo();

    (container.resolve as any).mockImplementation((name: string) => {
      if (name === 'organizationRepository') return orgRepo;
      if (name === 'organizationMembershipRepository') return membershipRepo;
      if (name === 'organizationInvitationRepository') return invitationRepo;
      return null;
    });

    service = new OrganizationService();
  });

  describe('createWithOwner - propagation to child orgs', () => {
    it('creates OWNER membership for the creator', async () => {
      orgRepo.findById.mockResolvedValue(null);
      orgRepo.create.mockResolvedValue({ id: 'child-1', _id: 'child-1' });
      membershipRepo.create.mockResolvedValue({});

      await service.createWithOwner({ name: 'child', displayName: 'Child' }, 'user-1');

      expect(membershipRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ _userId: 'user-1', role: 'OWNER' })
      );
    });

    it('propagates OWNER/ADMIN memberships from parent to new child', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', ancestors: [] });
      orgRepo.create.mockResolvedValue({ id: 'child-1', _id: 'child-1' });
      membershipRepo.create.mockResolvedValue({});
      membershipRepo.findDirectMemberships.mockResolvedValue([
        { _userId: 'owner-1', role: 'OWNER' },
        { _userId: 'admin-1', role: 'ADMIN' },
        { _userId: 'member-1', role: 'MEMBER' },
      ]);
      membershipRepo.createBulk.mockResolvedValue([]);

      await service.createWithOwner({ name: 'child', displayName: 'Child', _parentId: 'parent-1' }, 'user-1');

      expect(membershipRepo.createBulk).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ _userId: 'owner-1', _organizationId: 'child-1', role: 'OWNER' }),
          expect.objectContaining({ _userId: 'admin-1', _organizationId: 'child-1', role: 'ADMIN' }),
        ])
      );
      const call = membershipRepo.createBulk.mock.calls[0][0];
      expect(call).toHaveLength(2);
      const userIds = call.map((m: any) => m._userId);
      expect(userIds).not.toContain('member-1');
    });

    it('does not call createBulk when parent has no OWNER/ADMIN members', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', ancestors: [] });
      orgRepo.create.mockResolvedValue({ id: 'child-1', _id: 'child-1' });
      membershipRepo.create.mockResolvedValue({});
      membershipRepo.findDirectMemberships.mockResolvedValue([
        { _userId: 'member-1', role: 'MEMBER' },
      ]);

      await service.createWithOwner({ name: 'child', displayName: 'Child', _parentId: 'parent-1' }, 'user-1');

      expect(membershipRepo.createBulk).not.toHaveBeenCalled();
    });

    it('does not propagate when creating a top-level org', async () => {
      orgRepo.findById.mockResolvedValue(null);
      orgRepo.create.mockResolvedValue({ id: 'org-1', _id: 'org-1' });
      membershipRepo.create.mockResolvedValue({});

      await service.createWithOwner({ name: 'org', displayName: 'Org' }, 'user-1');

      expect(membershipRepo.findDirectMemberships).not.toHaveBeenCalled();
      expect(membershipRepo.createBulk).not.toHaveBeenCalled();
    });

    it('does not propagate MEMBER roles from parent', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', ancestors: [] });
      orgRepo.create.mockResolvedValue({ id: 'child-1', _id: 'child-1' });
      membershipRepo.create.mockResolvedValue({});
      membershipRepo.findDirectMemberships.mockResolvedValue([
        { _userId: 'member-1', role: 'MEMBER' },
        { _userId: 'member-2', role: 'MEMBER' },
      ]);

      await service.createWithOwner({ name: 'child', displayName: 'Child', _parentId: 'parent-1' }, 'user-1');

      expect(membershipRepo.createBulk).not.toHaveBeenCalled();
    });

    it('sets ancestors correctly from parent', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', ancestors: ['grandparent-1'] });
      orgRepo.create.mockResolvedValue({ id: 'child-1', _id: 'child-1' });
      membershipRepo.create.mockResolvedValue({});
      membershipRepo.findDirectMemberships.mockResolvedValue([]);

      await service.createWithOwner({ name: 'child', displayName: 'Child', _parentId: 'parent-1' }, 'user-1');

      expect(orgRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ ancestors: ['grandparent-1', 'parent-1'] })
      );
    });

    it('throws when parent org not found', async () => {
      orgRepo.findById.mockResolvedValue(null);

      await expect(
        service.createWithOwner({ name: 'child', displayName: 'Child', _parentId: 'nonexistent' }, 'user-1')
      ).rejects.toThrow('Parent organization not found');
    });
  });

  describe('updateMemberRole - cascading to children', () => {
    it('demoting to MEMBER removes child memberships', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', isPersonal: false });
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1', 'child-2']);
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'ADMIN' });
      membershipRepo.updateByUserAndOrganization.mockResolvedValue({});

      await service.updateMemberRole('user-1', 'parent-1', 'MEMBER', {
        id: 'admin-user',
        orgRole: 'OWNER',
      } as any);

      expect(membershipRepo.destroyByUserAndOrganization).toHaveBeenCalledWith('user-1', 'child-1');
      expect(membershipRepo.destroyByUserAndOrganization).toHaveBeenCalledWith('user-1', 'child-2');
    });

    it('promoting to ADMIN creates child memberships if missing', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', isPersonal: false });
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1']);
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'MEMBER' });
      membershipRepo.updateByUserAndOrganization.mockResolvedValue({});
      membershipRepo.findExistingMembership.mockResolvedValue(null);
      membershipRepo.create.mockResolvedValue({});

      await service.updateMemberRole('user-1', 'parent-1', 'ADMIN', {
        id: 'owner-user',
        orgRole: 'OWNER',
      } as any);

      expect(membershipRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ _userId: 'user-1', _organizationId: 'child-1', role: 'ADMIN' })
      );
    });

    it('promoting to ADMIN updates existing child memberships', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', isPersonal: false });
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1']);
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'MEMBER' });
      membershipRepo.updateByUserAndOrganization.mockResolvedValue({});
      membershipRepo.findExistingMembership.mockResolvedValue({ _id: 'existing-1' });

      await service.updateMemberRole('user-1', 'parent-1', 'ADMIN', {
        id: 'owner-user',
        orgRole: 'OWNER',
      } as any);

      expect(membershipRepo.updateByUserAndOrganization).toHaveBeenCalledWith('user-1', 'child-1', { role: 'ADMIN' });
      expect(membershipRepo.create).not.toHaveBeenCalled();
    });

    it('promoting to OWNER also creates child memberships', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', isPersonal: false });
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1']);
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'ADMIN' });
      membershipRepo.updateByUserAndOrganization.mockResolvedValue({});
      membershipRepo.findExistingMembership.mockResolvedValue(null);
      membershipRepo.create.mockResolvedValue({});

      await service.updateMemberRole('user-1', 'parent-1', 'OWNER', {
        id: 'owner-user',
        orgRole: 'OWNER',
      } as any);

      expect(membershipRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ _userId: 'user-1', _organizationId: 'child-1', role: 'OWNER' })
      );
    });

    it('does nothing to children when org has no children', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', isPersonal: false });
      orgRepo.findChildOrganizationIds.mockResolvedValue([]);
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'ADMIN' });
      membershipRepo.updateByUserAndOrganization.mockResolvedValue({});

      await service.updateMemberRole('user-1', 'parent-1', 'MEMBER', {
        id: 'owner-user',
        orgRole: 'OWNER',
      } as any);

      expect(membershipRepo.destroyByUserAndOrganization).not.toHaveBeenCalled();
      expect(membershipRepo.create).not.toHaveBeenCalled();
    });

    it('cascade only checks direct children (not grandchildren)', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', isPersonal: false });
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1']);
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'ADMIN' });
      membershipRepo.updateByUserAndOrganization.mockResolvedValue({});

      await service.updateMemberRole('user-1', 'parent-1', 'MEMBER', {
        id: 'owner-user',
        orgRole: 'OWNER',
      } as any);

      expect(orgRepo.findChildOrganizationIds).toHaveBeenCalledTimes(1);
      expect(orgRepo.findChildOrganizationIds).toHaveBeenCalledWith('parent-1');
    });
  });

  describe('addMember - propagation to children', () => {
    it('propagates OWNER membership to existing children', async () => {
      membershipRepo.findUserRoleInOrganization.mockResolvedValue(null);
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', isPersonal: false });
      membershipRepo.create.mockResolvedValue({});
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1']);

      await service.addMember('user-1', 'parent-1', 'OWNER');

      expect(membershipRepo.createBulk).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ _userId: 'user-1', _organizationId: 'child-1', role: 'OWNER' }),
        ])
      );
    });

    it('propagates ADMIN membership to existing children', async () => {
      membershipRepo.findUserRoleInOrganization.mockResolvedValue(null);
      membershipRepo.create.mockResolvedValue({});
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1', 'child-2']);

      await service.addMember('user-1', 'parent-1', 'ADMIN');

      expect(membershipRepo.createBulk).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ _userId: 'user-1', _organizationId: 'child-1', role: 'ADMIN' }),
          expect.objectContaining({ _userId: 'user-1', _organizationId: 'child-2', role: 'ADMIN' }),
        ])
      );
    });

    it('does NOT propagate MEMBER membership to children', async () => {
      membershipRepo.findUserRoleInOrganization.mockResolvedValue(null);
      membershipRepo.create.mockResolvedValue({});

      await service.addMember('user-1', 'parent-1', 'MEMBER');

      expect(orgRepo.findChildOrganizationIds).not.toHaveBeenCalled();
      expect(membershipRepo.createBulk).not.toHaveBeenCalled();
    });

    it('does not propagate when org has no children', async () => {
      membershipRepo.findUserRoleInOrganization.mockResolvedValue(null);
      membershipRepo.create.mockResolvedValue({});
      orgRepo.findChildOrganizationIds.mockResolvedValue([]);

      await service.addMember('user-1', 'parent-1', 'ADMIN');

      expect(membershipRepo.createBulk).not.toHaveBeenCalled();
    });

    it('throws when user is already a member', async () => {
      membershipRepo.findUserRoleInOrganization.mockResolvedValue('MEMBER');

      await expect(
        service.addMember('user-1', 'parent-1', 'MEMBER')
      ).rejects.toThrow('already a member');
    });
  });

  describe('removeMember - cascading to children', () => {
    it('removes membership from direct children', async () => {
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'ADMIN' });
      membershipRepo.destroyByUserAndOrganization.mockResolvedValue(true);
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1', 'child-2']);

      await service.removeMember('user-1', 'parent-1');

      expect(membershipRepo.destroyByUserAndOrganization).toHaveBeenCalledWith('user-1', 'child-1');
      expect(membershipRepo.destroyByUserAndOrganization).toHaveBeenCalledWith('user-1', 'child-2');
    });

    it('does nothing to children when org has no children', async () => {
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'MEMBER' });
      membershipRepo.destroyByUserAndOrganization.mockResolvedValue(true);
      orgRepo.findChildOrganizationIds.mockResolvedValue([]);

      await service.removeMember('user-1', 'parent-1');

      expect(membershipRepo.destroyByUserAndOrganization).toHaveBeenCalledTimes(1);
      expect(membershipRepo.destroyByUserAndOrganization).toHaveBeenCalledWith('user-1', 'parent-1');
    });

    it('throws when membership not found', async () => {
      membershipRepo.findByUserAndOrganization.mockResolvedValue(null);

      await expect(
        service.removeMember('user-1', 'parent-1')
      ).rejects.toThrow('membership not found');
    });
  });

  describe('edge cases', () => {
    it('propagation handles empty parent members list gracefully', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', ancestors: [] });
      orgRepo.create.mockResolvedValue({ id: 'child-1', _id: 'child-1' });
      membershipRepo.create.mockResolvedValue({});
      membershipRepo.findDirectMemberships.mockResolvedValue([]);

      await service.createWithOwner({ name: 'child', displayName: 'Child', _parentId: 'parent-1' }, 'user-1');

      expect(membershipRepo.createBulk).not.toHaveBeenCalled();
    });

    it('cascade handles mixed existing and non-existing child memberships', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', isPersonal: false });
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1', 'child-2']);
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'MEMBER' });
      membershipRepo.updateByUserAndOrganization.mockResolvedValue({});
      membershipRepo.findExistingMembership
        .mockResolvedValueOnce({ _id: 'existing-1' })
        .mockResolvedValueOnce(null);
      membershipRepo.create.mockResolvedValue({});

      await service.updateMemberRole('user-1', 'parent-1', 'ADMIN', {
        id: 'owner-user',
        orgRole: 'OWNER',
      } as any);

      expect(membershipRepo.updateByUserAndOrganization).toHaveBeenCalledWith('user-1', 'child-1', { role: 'ADMIN' });
      expect(membershipRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ _userId: 'user-1', _organizationId: 'child-2', role: 'ADMIN' })
      );
    });

    it('updateMemberRole returns the updated membership', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', isPersonal: false });
      orgRepo.findChildOrganizationIds.mockResolvedValue([]);
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'MEMBER' });
      const updatedMembership = { _id: 'mem-1', role: 'ADMIN' };
      membershipRepo.updateByUserAndOrganization.mockResolvedValue(updatedMembership);

      const result = await service.updateMemberRole('user-1', 'parent-1', 'ADMIN', {
        id: 'owner-user',
        orgRole: 'OWNER',
      } as any);

      expect(result).toEqual(updatedMembership);
    });

    it('demote to MEMBER removes from all children while updating parent', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', isPersonal: false });
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1', 'child-2', 'child-3']);
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'ADMIN' });
      membershipRepo.updateByUserAndOrganization.mockResolvedValue({});

      await service.updateMemberRole('user-1', 'parent-1', 'MEMBER', {
        id: 'owner-user',
        orgRole: 'OWNER',
      } as any);

      expect(membershipRepo.updateByUserAndOrganization).toHaveBeenCalledWith('user-1', 'parent-1', { role: 'MEMBER' });
      expect(membershipRepo.destroyByUserAndOrganization).toHaveBeenCalledTimes(3);
      const destroyArgs = membershipRepo.destroyByUserAndOrganization.mock.calls.map((c: any) => c[1]);
      expect(destroyArgs).toContain('child-1');
      expect(destroyArgs).toContain('child-2');
      expect(destroyArgs).toContain('child-3');
    });

    it('removeMember cascades deletion to all children', async () => {
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'ADMIN' });
      membershipRepo.destroyByUserAndOrganization.mockResolvedValue(true);
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1']);

      const result = await service.removeMember('user-1', 'parent-1');

      expect(result).toBe(true);
      expect(membershipRepo.destroyByUserAndOrganization).toHaveBeenCalledWith('user-1', 'child-1');
    });

    it('propagation creates memberships with correct joinedAt timestamp', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', ancestors: [] });
      orgRepo.create.mockResolvedValue({ id: 'child-1', _id: 'child-1' });
      membershipRepo.create.mockResolvedValue({});
      membershipRepo.findDirectMemberships.mockResolvedValue([
        { _userId: 'admin-1', role: 'ADMIN' },
      ]);
      membershipRepo.createBulk.mockResolvedValue([]);

      const before = Date.now();
      await service.createWithOwner({ name: 'child', displayName: 'Child', _parentId: 'parent-1' }, 'user-1');
      const after = Date.now();

      const bulkCall = membershipRepo.createBulk.mock.calls[0][0];
      const joinedAt = bulkCall[0].joinedAt.getTime();
      expect(joinedAt).toBeGreaterThanOrEqual(before);
      expect(joinedAt).toBeLessThanOrEqual(after);
    });

    it('cascade to children sets correct role in child memberships', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', isPersonal: false });
      orgRepo.findChildOrganizationIds.mockResolvedValue(['child-1']);
      membershipRepo.findByUserAndOrganization.mockResolvedValue({ role: 'MEMBER' });
      membershipRepo.updateByUserAndOrganization.mockResolvedValue({});
      membershipRepo.findExistingMembership.mockResolvedValue(null);
      membershipRepo.create.mockResolvedValue({});

      await service.updateMemberRole('user-1', 'parent-1', 'ADMIN', {
        id: 'owner-user',
        orgRole: 'OWNER',
      } as any);

      const createCall = membershipRepo.create.mock.calls[0][0];
      expect(createCall.role).toBe('ADMIN');
    });

    it('propagation handles very large number of parent members', async () => {
      orgRepo.findById.mockResolvedValue({ id: 'parent-1', ancestors: [] });
      orgRepo.create.mockResolvedValue({ id: 'child-1', _id: 'child-1' });
      membershipRepo.create.mockResolvedValue({});
      const members = Array.from({ length: 50 }, (_, i) => ({
        _userId: `user-${i}`,
        role: i % 3 === 0 ? 'OWNER' : i % 2 === 0 ? 'ADMIN' : 'MEMBER',
      }));
      membershipRepo.findDirectMemberships.mockResolvedValue(members);
      membershipRepo.createBulk.mockResolvedValue([]);

      await service.createWithOwner({ name: 'child', displayName: 'Child', _parentId: 'parent-1' }, 'user-1');

      const bulkCall = membershipRepo.createBulk.mock.calls[0][0];
      const expectedCount = members.filter(m => m.role === 'OWNER' || m.role === 'ADMIN').length;
      expect(bulkCall).toHaveLength(expectedCount);
    });
  });
});
