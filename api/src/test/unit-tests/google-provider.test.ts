import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleProvider } from '../../main/services/identity/GoogleProvider';

const { generateAuthUrl, getToken, verifyIdToken } = vi.hoisted(() => ({
  generateAuthUrl: vi.fn(),
  getToken: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    generateAuthUrl = generateAuthUrl;
    getToken = getToken;
    verifyIdToken = verifyIdToken;
  },
}));

const basePayload = {
  sub: '110248495921238986420',
  email: 'fran.garcia@gmail.com',
  email_verified: true,
  given_name: 'Fran',
  family_name: 'García',
};

const mockTokenExchange = (payload: Partial<typeof basePayload> | null) => {
  getToken.mockResolvedValue({ tokens: { id_token: 'jwt-from-google' } });
  verifyIdToken.mockResolvedValue({ getPayload: () => payload });
};

describe('GoogleProvider', () => {
  const provider = new GoogleProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildLoginUrl', () => {
    it('requests the OIDC scopes and forwards the CSRF state', () => {
      generateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?...');

      const url = provider.buildLoginUrl('state-123');

      expect(url).toBe('https://accounts.google.com/o/oauth2/v2/auth?...');
      expect(generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: ['openid', 'email', 'profile'],
          state: 'state-123',
        }),
      );
    });
  });

  describe('handleCallback', () => {
    it('returns null when no code is present', async () => {
      const result = await provider.handleCallback({});
      expect(result).toBeNull();
      expect(getToken).not.toHaveBeenCalled();
    });

    it('returns null when the token exchange yields no id_token', async () => {
      getToken.mockResolvedValue({ tokens: {} });
      const result = await provider.handleCallback({ code: '4/abc' });
      expect(result).toBeNull();
      expect(verifyIdToken).not.toHaveBeenCalled();
    });

    it('maps the verified id_token claims into a ProviderProfile', async () => {
      mockTokenExchange(basePayload);

      const profile = await provider.handleCallback({ code: '4/abc' });

      expect(getToken).toHaveBeenCalledWith('4/abc');
      expect(verifyIdToken).toHaveBeenCalledWith(
        expect.objectContaining({ idToken: 'jwt-from-google' }),
      );
      expect(profile).toEqual({
        provider: 'google',
        providerId: '110248495921238986420',
        email: 'fran.garcia@gmail.com',
        emailVerified: true,
        firstName: 'Fran',
        lastName: 'García',
        suggestedUsername: 'fran.garcia',
      });
    });

    it('returns null when the payload lacks sub or email', async () => {
      mockTokenExchange({ ...basePayload, email: undefined } as any);
      expect(await provider.handleCallback({ code: '4/abc' })).toBeNull();

      mockTokenExchange(null);
      expect(await provider.handleCallback({ code: '4/abc' })).toBeNull();
    });

    it('only marks the email verified when Google says so explicitly', async () => {
      mockTokenExchange({ ...basePayload, email_verified: undefined } as any);
      const profile = await provider.handleCallback({ code: '4/abc' });
      expect(profile?.emailVerified).toBe(false);
    });

    it('falls back to the email local part when name claims are missing', async () => {
      mockTokenExchange({ ...basePayload, given_name: undefined, family_name: undefined } as any);

      const profile = await provider.handleCallback({ code: '4/abc' });

      expect(profile?.firstName).toBe('fran.garcia');
      expect(profile?.lastName).toBe('Google');
    });
  });
});
