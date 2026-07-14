import { IdentityProvider, ProviderProfile } from './IdentityProvider';

// Official US endpoints (sic.us.es → "Descripción y uso del servicio"):
//   production:    https://sso.us.es/CAS/
//   preproduction: https://ssopre.us.es/CAS/  (note the uppercase /CAS/ path)
const CAS_BASE_URL = () => process.env.SSO_US_CAS_URL ?? 'https://sso.us.es/CAS';
const CALLBACK_URL = () =>
  process.env.SSO_US_CALLBACK_URL ??
  `http://localhost:${process.env.SERVER_PORT ?? 8080}${process.env.BASE_URL_PATH ?? ''}/api/v1/users/auth/sso/us/callback`;

/**
 * Identity provider for the Universidad de Sevilla SSO (CAS protocol).
 *
 * The US SSO (adAS) supports CAS 1.0/2.0, so validation uses /serviceValidate.
 * Attribute names (cas:mail, cas:givenName, cas:schacSn1...) are the ones assumed by
 * previous research and MUST be verified against the real serviceValidate response
 * (see docs/sso-uvus-design.md §11.10). Set SSO_DEBUG_XML=true to log the raw XML
 * during preproduction testing and adjust the parsing if names differ.
 */
export class UsCasProvider implements IdentityProvider {
  name = 'us-sso' as const;
  usesState = false;

  buildLoginUrl(_state: string): string {
    // CAS does not use `state`: the ticket is single-use and validated server-side.
    return `${CAS_BASE_URL()}/login?service=${encodeURIComponent(CALLBACK_URL())}`;
  }

  async handleCallback(query: Record<string, string>): Promise<ProviderProfile | null> {
    const ticket = query.ticket;
    if (!ticket) return null;

    const validateUrl = `${CAS_BASE_URL()}/serviceValidate?ticket=${encodeURIComponent(ticket)}&service=${encodeURIComponent(CALLBACK_URL())}`;
    const response = await fetch(validateUrl);
    const xml = await response.text();

    if (process.env.SSO_DEBUG_XML === 'true') {
      console.log('[SSO][us-cas] raw serviceValidate response:\n', xml);
    }

    const userMatch = xml.match(/<cas:user>([^<]+)<\/cas:user>/);
    if (!userMatch) return null;

    const pick = (tag: string): string | null => {
      const match = xml.match(new RegExp(`<cas:${tag}>([^<]+)</cas:${tag}>`));
      return match ? match[1].trim() : null;
    };

    const uvus = userMatch[1].trim();
    const lastName =
      [pick('schacSn1'), pick('schacSn2')].filter(Boolean).join(' ') || pick('sn') || 'US';

    return {
      provider: this.name,
      providerId: uvus,
      email: pick('mail') ?? `${uvus}@alum.us.es`,
      emailVerified: false, // the US does not guarantee email ownership
      firstName: pick('givenName') ?? uvus,
      lastName,
    };
  }
}
