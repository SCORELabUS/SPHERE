export type ProviderName = 'us-sso' | 'google';

/**
 * Normalized identity profile. Every external provider (CAS, OAuth2, ...) translates
 * its raw response into this shape; the rest of the system never sees provider-specific
 * data. Providers are responsible for resolving their own fallbacks/defaults.
 */
export interface ProviderProfile {
  provider: ProviderName;
  providerId: string;
  email: string;
  /** Whether the provider guarantees the email belongs to the user (Google: yes, US CAS: no). */
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  /** Optional human-readable username base. Defaults to providerId when absent. */
  suggestedUsername?: string;
}

export interface IdentityProvider {
  name: ProviderName;

  /**
   * Whether the provider relies on the OAuth2 `state` parameter for CSRF protection.
   * When true, the common layer stores the state on initiate and requires a matching,
   * unexpired state on callback (single use). CAS providers don't need it: the ticket
   * is single-use and validated server-side.
   */
  usesState: boolean;

  /** Absolute URL to redirect the browser to for login. `state` is used by OAuth2 providers; CAS ignores it. */
  buildLoginUrl(state: string): string;

  /** Translates the callback query params (ticket | code) into a normalized profile, or null if invalid. */
  handleCallback(query: Record<string, string>): Promise<ProviderProfile | null>;
}
