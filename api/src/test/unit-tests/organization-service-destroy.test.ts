import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../main/config/container', () => ({
  default: {
    resolve: vi.fn(),
  },
}));

import container from '../../main/config/container';
import OrganizationService from '../../main/services/OrganizationService';

function createMockOrgRepo() {
  return {
    findById: vi.fn(),
    destroy: vi.fn().mockResolvedValue(true),
  };
}

function createMockMembershipRepo() {
  return {
    destroyByOrganizationId: vi.fn(),
  };
}

function createMockInvitationRepo() {
  return {
    destroyByOrganizationId: vi.fn(),
  };
}

function createMockPricingRepo() {
  return {
    destroyByOrganizationId: vi.fn(),
  };
}

function createMockPricingCollectionRepo() {
  return {
    destroyByOrganizationId: vi.fn(),
  };
}

function createMockEntityPermissionRepo() {
  return {
    destroyByOrganizationId: vi.fn(),
  };
}

describe('OrganizationService.destroy cascade cleanup', () => {
  let orgRepo: ReturnType<typeof createMockOrgRepo>;
  let membershipRepo: ReturnType<typeof createMockMembershipRepo>;
  let invitationRepo: ReturnType<typeof createMockInvitationRepo>;
  let pricingRepo: ReturnType<typeof createMockPricingRepo>;
  let pricingCollectionRepo: ReturnType<typeof createMockPricingCollectionRepo>;
  let entityPermissionRepo: ReturnType<typeof createMockEntityPermissionRepo>;
  let service: OrganizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    orgRepo = createMockOrgRepo();
    membershipRepo = createMockMembershipRepo();
    invitationRepo = createMockInvitationRepo();
    pricingRepo = createMockPricingRepo();
    pricingCollectionRepo = createMockPricingCollectionRepo();
    entityPermissionRepo = createMockEntityPermissionRepo();

    (container.resolve as any).mockImplementation((name: string) => {
      if (name === 'organizationRepository') return orgRepo;
      if (name === 'organizationMembershipRepository') return membershipRepo;
      if (name === 'organizationInvitationRepository') return invitationRepo;
      if (name === 'pricingRepository') return pricingRepo;
      if (name === 'pricingCollectionRepository') return pricingCollectionRepo;
      if (name === 'entityPermissionRepository') return entityPermissionRepo;
      return null;
    });

    service = new OrganizationService();
  });

  it('removes pricings, collections and entity permissions before deleting the organization', async () => {
    orgRepo.findById.mockResolvedValue({ id: 'org-1', isPersonal: false });

    await service.destroy('org-1');

    expect(pricingRepo.destroyByOrganizationId).toHaveBeenCalledWith('org-1');
    expect(pricingCollectionRepo.destroyByOrganizationId).toHaveBeenCalledWith('org-1');
    expect(entityPermissionRepo.destroyByOrganizationId).toHaveBeenCalledWith('org-1');
    expect(membershipRepo.destroyByOrganizationId).toHaveBeenCalledWith('org-1');
    expect(invitationRepo.destroyByOrganizationId).toHaveBeenCalledWith('org-1');
    expect(orgRepo.destroy).toHaveBeenCalledWith('org-1');
  });

  it('refuses to delete a personal organization unless explicitly bypassed', async () => {
    orgRepo.findById.mockResolvedValue({ id: 'org-1', isPersonal: true });

    await expect(service.destroy('org-1')).rejects.toThrow('Personal organizations cannot be deleted');
    expect(pricingRepo.destroyByOrganizationId).not.toHaveBeenCalled();
    expect(orgRepo.destroy).not.toHaveBeenCalled();
  });

  it('allows deleting a personal organization when the skip flag is set (account deletion)', async () => {
    orgRepo.findById.mockResolvedValue({ id: 'org-1', isPersonal: true });

    await service.destroy('org-1', true);

    expect(pricingRepo.destroyByOrganizationId).toHaveBeenCalledWith('org-1');
    expect(orgRepo.destroy).toHaveBeenCalledWith('org-1');
  });
});
