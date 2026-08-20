import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../main/config/container', () => ({
  default: { resolve: vi.fn() },
}));

import container from '../../main/config/container';
import AuthProviderService from '../../main/services/AuthProviderService';

const googleProfile = {
  provider: 'google' as const,
  providerId: 'google-sub-1',
  email: 'Person@Example.com',
  emailVerified: true,
  firstName: 'Test',
  lastName: 'Person',
};

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    username: 'person',
    email: 'person@example.com',
    role: 'USER',
    firstName: 'Test',
    lastName: 'Person',
    identities: [],
    apiKeys: [],
    ...overrides,
  };
}

describe('AuthProviderService identity management', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let service: AuthProviderService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = {
      findOne: vi.fn(),
      findById: vi.fn(),
      findByIdWithPassword: vi.fn(),
      addIdentity: vi.fn(),
      removeIdentity: vi.fn(),
      setInitialPassword: vi.fn(),
      changePassword: vi.fn(),
    };

    (container.resolve as any).mockImplementation((name: string) => {
      if (name === 'userRepository') return repository;
      if (name === 'organizationService') return {};
      return undefined;
    });
    service = new AuthProviderService();
  });

  it('returns only safe sign-in method metadata', async () => {
    repository.findByIdWithPassword.mockResolvedValue(user({
      password: 'hashed-secret',
      identities: [{
        provider: 'google',
        providerId: 'private-provider-id',
        email: 'person@example.com',
        emailVerified: true,
        linkedAt: new Date('2026-01-01T00:00:00.000Z'),
      }],
    }));

    const result = await service.getAuthenticationMethods('user-1');

    expect(result.hasPassword).toBe(true);
    expect(result.identities[0]).not.toHaveProperty('providerId');
    expect(result.identities[0]).toMatchObject({
      provider: 'google',
      email: 'person@example.com',
      emailVerified: true,
    });
  });

  it('refuses an identity already owned by another SPHERE account', async () => {
    repository.findOne.mockResolvedValue(user({ id: 'user-2' }));

    await expect(service.linkIdentity('user-1', googleProfile)).rejects.toThrow(
      'already belongs to another SPHERE account'
    );
    expect(repository.addIdentity).not.toHaveBeenCalled();
  });

  it('links a proven identity without relying on matching emails', async () => {
    repository.findOne.mockResolvedValue(null);
    repository.findById.mockResolvedValue(user());
    repository.addIdentity.mockResolvedValue(user({ identities: [googleProfile] }));
    repository.findByIdWithPassword.mockResolvedValue(user({ identities: [googleProfile] }));

    await service.linkIdentity('user-1', googleProfile);

    expect(repository.addIdentity).toHaveBeenCalledWith('user-1', expect.objectContaining({
      provider: 'google',
      providerId: 'google-sub-1',
      email: 'person@example.com',
      emailVerified: true,
    }));
  });

  it('does not disconnect the last available sign-in method', async () => {
    repository.findByIdWithPassword.mockResolvedValue(user({
      identities: [{ ...googleProfile, linkedAt: new Date() }],
    }));

    await expect(service.unlinkIdentity('user-1', 'google')).rejects.toThrow(
      'Add another sign-in method'
    );
    expect(repository.removeIdentity).not.toHaveBeenCalled();
  });

  it('allows disconnecting an identity when a local password exists', async () => {
    repository.findByIdWithPassword
      .mockResolvedValueOnce(user({
        password: 'hashed-secret',
        identities: [{ ...googleProfile, linkedAt: new Date() }],
      }))
      .mockResolvedValueOnce(user({ password: 'hashed-secret', identities: [] }));
    repository.removeIdentity.mockResolvedValue(user({ identities: [] }));

    const result = await service.unlinkIdentity('user-1', 'google');

    expect(repository.removeIdentity).toHaveBeenCalledWith('user-1', 'google');
    expect(result).toEqual({ hasPassword: true, identities: [] });
  });

  it('delegates initial password creation to the repository', async () => {
    repository.setInitialPassword.mockResolvedValue(undefined);
    repository.findByIdWithPassword.mockResolvedValue(user({ password: 'hashed-secret' }));

    const result = await service.setInitialPassword('user-1', 'secure-pass');

    expect(repository.setInitialPassword).toHaveBeenCalledWith('user-1', 'secure-pass');
    expect(result.hasPassword).toBe(true);
  });

  it('delegates password changes to the repository, which verifies the current password', async () => {
    repository.changePassword.mockResolvedValue(undefined);
    repository.findByIdWithPassword.mockResolvedValue(user({ password: 'hashed-secret' }));

    const result = await service.changePassword('user-1', 'old-pass', 'new-secure-pass');

    expect(repository.changePassword).toHaveBeenCalledWith('user-1', 'old-pass', 'new-secure-pass');
    expect(result.hasPassword).toBe(true);
  });

  it('propagates the repository rejection when the current password is wrong', async () => {
    repository.changePassword.mockRejectedValue(new Error('INVALID DATA: Current password is incorrect'));

    await expect(service.changePassword('user-1', 'wrong-pass', 'new-secure-pass')).rejects.toThrow(
      'Current password is incorrect'
    );
  });
});
