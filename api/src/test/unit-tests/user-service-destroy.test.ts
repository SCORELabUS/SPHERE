import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../main/config/container', () => ({
  default: {
    resolve: vi.fn(),
  },
}));

import container from '../../main/config/container';
import UserService from '../../main/services/UserService';

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    username: 'person',
    role: 'USER',
    firstName: 'Test',
    lastName: 'Person',
    email: 'person@example.com',
    apiKeys: [],
    ...overrides,
  };
}

describe('UserService.destroy (account deletion)', () => {
  let userRepository: Record<string, ReturnType<typeof vi.fn>>;
  let organizationService: Record<string, ReturnType<typeof vi.fn>>;
  let organizationMembershipRepository: Record<string, ReturnType<typeof vi.fn>>;
  let entityPermissionRepository: Record<string, ReturnType<typeof vi.fn>>;
  let notificationRepository: Record<string, ReturnType<typeof vi.fn>>;
  let service: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    userRepository = {
      findByUsername: vi.fn(),
      find: vi.fn().mockResolvedValue([]),
      destroy: vi.fn().mockResolvedValue(true),
    };
    organizationService = {
      destroy: vi.fn(),
      listMembers: vi.fn().mockResolvedValue([]),
      updateMemberRole: vi.fn(),
      removeMember: vi.fn(),
    };
    organizationMembershipRepository = {
      findByUserId: vi.fn().mockResolvedValue([]),
    };
    entityPermissionRepository = {
      destroyByUserId: vi.fn(),
    };
    notificationRepository = {
      destroyByUserId: vi.fn(),
    };

    (container.resolve as any).mockImplementation((name: string) => {
      if (name === 'userRepository') return userRepository;
      if (name === 'organizationService') return organizationService;
      if (name === 'organizationMembershipRepository') return organizationMembershipRepository;
      if (name === 'entityPermissionRepository') return entityPermissionRepository;
      if (name === 'notificationRepository') return notificationRepository;
      if (name === 'emailVerificationService') return {};
      return null;
    });

    service = new UserService();
  });

  it('lets a user delete their own account and cleans up orphaned references', async () => {
    const target = user();
    userRepository.findByUsername.mockResolvedValue(target);
    organizationMembershipRepository.findByUserId.mockResolvedValue([
      { organization: { id: 'org-1', isPersonal: true }, role: 'OWNER' },
    ]);

    const result = await service.destroy(target as any, 'person');

    expect(result).toBe(true);
    expect(organizationService.destroy).toHaveBeenCalledWith('org-1', true);
    expect(entityPermissionRepository.destroyByUserId).toHaveBeenCalledWith('user-1');
    expect(notificationRepository.destroyByUserId).toHaveBeenCalledWith('user-1');
    expect(userRepository.destroy).toHaveBeenCalledWith('person');
  });

  it('refuses to let a non-admin delete another user account', async () => {
    const reqUser = user({ id: 'user-1', username: 'person', role: 'USER' });

    await expect(service.destroy(reqUser as any, 'someone-else')).rejects.toThrow(
      'You can only delete your own user'
    );
    expect(userRepository.destroy).not.toHaveBeenCalled();
  });

  it('blocks deleting the last remaining admin', async () => {
    const admin = user({ id: 'admin-1', username: 'admin', role: 'ADMIN' });
    userRepository.findByUsername.mockResolvedValue(admin);
    userRepository.find.mockResolvedValue([admin]);

    await expect(service.destroy(admin as any, 'admin')).rejects.toThrow(
      'There must always be at least one ADMIN user'
    );
    expect(userRepository.destroy).not.toHaveBeenCalled();
    expect(entityPermissionRepository.destroyByUserId).not.toHaveBeenCalled();
  });
});
