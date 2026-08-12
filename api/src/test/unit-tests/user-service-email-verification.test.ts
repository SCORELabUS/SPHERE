import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  repository: {
    findByUsername: vi.fn(),
    findByEmail: vi.fn(),
    create: vi.fn(),
    updateToken: vi.fn(),
  },
  organizationService: {
    ensurePersonalOrganizationForUser: vi.fn(),
  },
  emailVerificationService: {
    sendForUser: vi.fn(),
  },
  membershipRepository: {},
}));

vi.mock('../../main/config/container', () => ({
  default: {
    resolve: vi.fn((name: string) => {
      if (name === 'userRepository') return mocks.repository;
      if (name === 'organizationService') return mocks.organizationService;
      if (name === 'emailVerificationService') return mocks.emailVerificationService;
      if (name === 'organizationMembershipRepository') return mocks.membershipRepository;
      return undefined;
    }),
  },
}));

import UserService from '../../main/services/UserService';

describe('UserService registration verification', () => {
  let service: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserService();
  });

  it('creates public registrations as pending and does not issue a JWT', async () => {
    const createdUser = {
      id: 'user-1',
      username: 'person',
      password: 'hashed-password',
      role: 'USER',
      firstName: 'Test',
      lastName: 'Person',
      email: 'person@example.com',
      emailVerified: false,
      emailVerificationTokenHash: 'private-hash',
      token: 'private-legacy-token',
      tokenExpiration: new Date(),
      apiKeys: [],
    };
    mocks.repository.findByUsername.mockResolvedValue(null);
    mocks.repository.findByEmail.mockResolvedValue(null);
    mocks.repository.create.mockResolvedValue(createdUser);
    mocks.emailVerificationService.sendForUser.mockResolvedValue(true);

    const result = await service.register({
      username: 'person',
      password: 'password123',
      firstName: 'Test',
      lastName: 'Person',
      email: 'Person@Example.com',
    }, undefined as any);

    expect(mocks.repository.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'person@example.com',
      emailVerified: false,
    }));
    expect(mocks.emailVerificationService.sendForUser).toHaveBeenCalledWith(createdUser);
    expect(result).not.toHaveProperty('token');
    expect(result.registeredUser).not.toHaveProperty('password');
    expect(result.registeredUser).not.toHaveProperty('emailVerificationTokenHash');
    expect(result.registeredUser).not.toHaveProperty('token');
    expect(result.registeredUser).not.toHaveProperty('tokenExpiration');
    expect(result).toMatchObject({ emailVerificationRequired: true, emailSent: true });
  });

  it('rejects a correct password until the email is verified', async () => {
    const password = 'password123';
    mocks.repository.findByUsername.mockResolvedValue({
      id: 'user-1',
      username: 'person',
      password: await bcrypt.hash(password, 5),
      role: 'USER',
      firstName: 'Test',
      lastName: 'Person',
      email: 'person@example.com',
      emailVerified: false,
      apiKeys: [],
    });

    await expect(service.login('person', password)).rejects.toThrow('Verify your email address');
    expect(mocks.repository.updateToken).not.toHaveBeenCalled();
  });

  it('keeps legacy accounts without the verification field able to sign in', async () => {
    const password = 'password123';
    mocks.repository.findByUsername.mockResolvedValue({
      id: 'legacy-user',
      username: 'legacy',
      password: await bcrypt.hash(password, 5),
      role: 'USER',
      firstName: 'Legacy',
      lastName: 'User',
      email: 'legacy@example.com',
      apiKeys: [],
    });
    mocks.repository.updateToken.mockResolvedValue({});

    const result = await service.login('legacy', password);

    expect(result.token).toEqual(expect.any(String));
  });
});
