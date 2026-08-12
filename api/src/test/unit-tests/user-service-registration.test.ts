import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../main/config/container', () => ({
  default: { resolve: vi.fn() },
}));

import container from '../../main/config/container';
import UserService from '../../main/services/UserService';

describe('UserService registration identity conflicts', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let service: UserService;

  const payload = () => ({
    firstName: 'Google',
    lastName: 'User',
    username: 'new-local-user',
    email: 'Google.User@Example.com',
    password: 'password123',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    repository = {
      findByEmail: vi.fn(),
      findByUsername: vi.fn(),
      create: vi.fn(),
    };

    (container.resolve as any).mockImplementation((name: string) => {
      if (name === 'userRepository') return repository;
      if (name === 'organizationService') return { ensurePersonalOrganizationForUser: vi.fn() };
      if (name === 'organizationMembershipRepository') return {};
      return undefined;
    });
    service = new UserService();
  });

  it('does not let public registration set a password on an existing SSO email', async () => {
    repository.findByEmail.mockResolvedValue({
      id: 'google-user',
      email: 'google.user@example.com',
      identities: [{ provider: 'google', providerId: 'google-sub' }],
    });

    await expect(service.register(payload(), undefined as any)).rejects.toThrow(
      'Sign in with its existing method'
    );
    expect(repository.findByEmail).toHaveBeenCalledWith('google.user@example.com');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('sanitizes a duplicate-email error caused by concurrent registrations', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.findByUsername.mockResolvedValue(null);
    repository.create.mockRejectedValue({
      code: 11000,
      keyPattern: { email: 1 },
      keyValue: { email: 'google.user@example.com' },
    });

    await expect(service.register(payload(), undefined as any)).rejects.toThrow(
      'INVALID DATA: There is already a user with that email address'
    );
    await expect(service.register(payload(), undefined as any)).rejects.not.toThrow('E11000');
  });
});
