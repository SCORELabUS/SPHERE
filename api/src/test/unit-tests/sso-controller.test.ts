import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cache: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
  authProviderService: {
    findOrCreateUser: vi.fn(),
    linkIdentity: vi.fn(),
  },
  provider: {
    name: 'google',
    buildLoginUrl: vi.fn(),
    handleCallback: vi.fn(),
  },
}));

vi.mock('../../main/config/container', () => ({
  default: {
    resolve: vi.fn((name: string) => {
      if (name === 'cacheService') return mocks.cache;
      if (name === 'authProviderService') return mocks.authProviderService;
      return undefined;
    }),
  },
}));

vi.mock('../../main/services/identity/providerRegistry', () => ({
  getProvider: vi.fn(() => mocks.provider),
}));

import SSOController from '../../main/controllers/SSOController';
import { IdentityOwnedByAnotherAccountError } from '../../main/services/AuthProviderService';

function response() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.redirect = vi.fn(() => res);
  return res;
}

const profile = {
  provider: 'google',
  providerId: 'google-sub',
  email: 'person@example.com',
  emailVerified: true,
  firstName: 'Test',
  lastName: 'Person',
};

describe('SSOController flow transactions', () => {
  let controller: SSOController;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider.buildLoginUrl.mockImplementation((state: string) => `https://provider.test/login?state=${state}`);
    mocks.provider.handleCallback.mockResolvedValue(profile);
    controller = new SSOController();
  });

  it('stores a single-use login transaction for every provider', async () => {
    const res = response();

    await controller.initiate({ params: { provider: 'google' } }, res);

    expect(mocks.cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^sso:flow:/),
      { action: 'login' },
      600
    );
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('https://provider.test/login?state='));
  });

  it('links the identity to the user captured in the transaction', async () => {
    const res = response();
    mocks.cache.get.mockResolvedValue({ action: 'link', userId: 'user-1', provider: 'google' });

    await controller.callback(
      { params: { provider: 'google' }, query: { state: 'state-1', code: 'provider-code' } },
      res
    );

    expect(mocks.cache.del).toHaveBeenCalledWith('sso:flow:state-1');
    expect(mocks.authProviderService.linkIdentity).toHaveBeenCalledWith('user-1', profile);
    expect(mocks.authProviderService.findOrCreateUser).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/me/settings?section=integrations&identity_linked=google')
    );
  });

  it('rejects callbacks without a known transaction', async () => {
    const res = response();
    mocks.cache.get.mockResolvedValue(null);

    await controller.callback(
      { params: { provider: 'google' }, query: { state: 'expired-state' } },
      res
    );

    expect(mocks.provider.handleCallback).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('sso_error=invalid_state'));
  });

  it('rejects linking an identity that belongs to another account', async () => {
    const res = response();
    mocks.cache.get.mockResolvedValue({ action: 'link', userId: 'target-user', provider: 'google' });
    mocks.authProviderService.linkIdentity.mockRejectedValue(
      new IdentityOwnedByAnotherAccountError()
    );

    await controller.callback(
      { params: { provider: 'google' }, query: { state: 'state-1', code: 'provider-code' } },
      res
    );

    expect(mocks.cache.set).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/me/settings?section=integrations&identity_error=identity_in_use')
    );
  });
});
