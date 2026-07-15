import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsCasProvider } from '../../main/services/identity/UsCasProvider';

const successXml = (overrides: Partial<Record<string, string | null>> = {}) => {
  const attrs: Record<string, string | null> = {
    mail: 'frcapote@alum.us.es',
    givenName: 'Francisco',
    schacSn1: 'Capote',
    schacSn2: 'García',
    ...overrides,
  };

  const attrXml = Object.entries(attrs)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `<cas:${k}>${v}</cas:${k}>`)
    .join('\n');

  return `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationSuccess>
    <cas:user>frcapote</cas:user>
    <cas:attributes>${attrXml}</cas:attributes>
  </cas:authenticationSuccess>
</cas:serviceResponse>`;
};

const failureXml = `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationFailure code="INVALID_TICKET">Ticket ST-x not recognized</cas:authenticationFailure>
</cas:serviceResponse>`;

const mockFetchXml = (xml: string) => {
  const fetchMock = vi.fn().mockResolvedValue({ text: () => Promise.resolve(xml) });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('UsCasProvider', () => {
  const provider = new UsCasProvider();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('buildLoginUrl', () => {
    it('points to the CAS login with the callback as encoded service', () => {
      const url = provider.buildLoginUrl('ignored-state');
      expect(url).toContain('/login?service=');
      expect(url).toContain(encodeURIComponent('/users/auth/sso/us/callback'));
    });
  });

  describe('handleCallback', () => {
    it('returns null when no ticket is present', async () => {
      const result = await provider.handleCallback({});
      expect(result).toBeNull();
    });

    it('parses a successful CAS response into a ProviderProfile', async () => {
      const fetchMock = mockFetchXml(successXml());

      const profile = await provider.handleCallback({ ticket: 'ST-123' });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toContain('/serviceValidate?ticket=ST-123');
      expect(profile).toEqual({
        provider: 'us-sso',
        providerId: 'frcapote',
        email: 'frcapote@alum.us.es',
        emailVerified: false,
        firstName: 'Francisco',
        lastName: 'Capote García',
      });
    });

    it('returns null on an authenticationFailure response', async () => {
      mockFetchXml(failureXml);
      const profile = await provider.handleCallback({ ticket: 'ST-bad' });
      expect(profile).toBeNull();
    });

    it('falls back to {uvus}@alum.us.es when mail is missing', async () => {
      mockFetchXml(successXml({ mail: null }));
      const profile = await provider.handleCallback({ ticket: 'ST-123' });
      expect(profile?.email).toBe('frcapote@alum.us.es');
    });

    it('falls back to the uvus as firstName when givenName is missing', async () => {
      mockFetchXml(successXml({ givenName: null }));
      const profile = await provider.handleCallback({ ticket: 'ST-123' });
      expect(profile?.firstName).toBe('frcapote');
    });

    it('uses cas:sn as lastName fallback when schacSn1/schacSn2 are missing', async () => {
      mockFetchXml(successXml({ schacSn1: null, schacSn2: null, sn: 'Capote' }));
      const profile = await provider.handleCallback({ ticket: 'ST-123' });
      expect(profile?.lastName).toBe('Capote');
    });

    it('parses the REAL adAS preproduction response (captured 10/07/2026, user pruebalum)', async () => {
      // Verbatim serviceValidate response from https://ssopre.us.es/CAS — note the
      // lowercase attribute tags (givenname, mail, uid) and repeated edupersonaffiliation.
      const realXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
        '<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>pruebalum</cas:user><cas:attributes><cas:edupersonaffiliation>member</cas:edupersonaffiliation><cas:edupersonaffiliation>student</cas:edupersonaffiliation><cas:givenname>IDENTIDAD</cas:givenname><cas:mail>pruebalum@alum.us.es</cas:mail><cas:schacSn1>DE</cas:schacSn1><cas:schacSn2>PRUEBAS ALUMNO</cas:schacSn2><cas:uid>pruebalum</cas:uid></cas:attributes></cas:authenticationSuccess></cas:serviceResponse>';
      mockFetchXml(realXml);

      const profile = await provider.handleCallback({ ticket: 'ST-real' });

      expect(profile).toEqual({
        provider: 'us-sso',
        providerId: 'pruebalum',
        email: 'pruebalum@alum.us.es',
        emailVerified: false,
        firstName: 'IDENTIDAD',
        lastName: 'DE PRUEBAS ALUMNO',
      });
    });

    it('accepts email addresses that pass the user model regex', async () => {
      // Same regex as UserMongoose email match: multi-level US domains must pass.
      const modelEmailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
      mockFetchXml(successXml());
      const profile = await provider.handleCallback({ ticket: 'ST-123' });
      expect(profile?.email).toMatch(modelEmailRegex);
      expect('someone@us.es').toMatch(modelEmailRegex);
      expect('some.one-x@alum.us.es').toMatch(modelEmailRegex);
    });
  });
});
