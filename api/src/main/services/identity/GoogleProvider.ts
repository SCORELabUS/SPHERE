import { OAuth2Client } from 'google-auth-library';
import { IdentityProvider, ProviderProfile } from './IdentityProvider';

const CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = () => process.env.GOOGLE_CLIENT_SECRET ?? '';
const CALLBACK_URL = () =>
  process.env.GOOGLE_CALLBACK_URL ??
  `http://localhost:${process.env.SERVER_PORT ?? 8080}${process.env.BASE_URL_PATH ?? ''}/api/v1/users/auth/sso/google/callback`;

/**
 * Identity provider for Google (OAuth2 / OpenID Connect, authorization code flow).
 *
 * The callback exchanges the `code` for an `id_token` and verifies it with
 * `verifyIdToken` (signature, issuer, audience, expiration) — no userinfo call needed:
 * the OIDC claims (sub, email, email_verified, given_name, family_name) are enough.
 * Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (see docs/social-login-google-prep.md
 * §2 for the Google Cloud Console setup).
 */
export class GoogleProvider implements IdentityProvider {
  name = 'google' as const;

  // Built per call so env changes (tests, dotenv load order) are always picked up.
  private client(): OAuth2Client {
    return new OAuth2Client(CLIENT_ID(), CLIENT_SECRET(), CALLBACK_URL());
  }

  buildLoginUrl(state: string): string {
    return this.client().generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      access_type: 'online',
      prompt: 'select_account',
    });
  }

  async handleCallback(query: Record<string, string>): Promise<ProviderProfile | null> {
    const code = query.code;
    if (!code) return null;

    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return null;

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: CLIENT_ID(),
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) return null;

    // Google's `sub` is a ~21-digit number, useless as a human-readable username:
    // suggest the local part of the email instead (resolveFreeUsername handles clashes).
    const emailLocalPart = payload.email.split('@')[0];

    return {
      provider: this.name,
      providerId: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      firstName: payload.given_name ?? emailLocalPart,
      lastName: payload.family_name ?? 'Google',
      suggestedUsername: emailLocalPart,
    };
  }
}
