import crypto from 'crypto';
import container from '../config/container';
import AuthProviderService, { IdentityOwnedByAnotherAccountError } from '../services/AuthProviderService';
import CacheService from '../services/CacheService';
import { getProvider } from '../services/identity/providerRegistry';
import {
  SSO_FLOW_CACHE_PREFIX,
  SSO_FLOW_TTL_SECONDS,
  SsoFlow,
} from '../services/identity/SsoFlow';
import { handleError } from '../utils/users/helpers';

const FRONTEND_URL = () => process.env.FRONTEND_URL ?? 'http://localhost:5173';
const SSO_CODE_TTL = 30; // seconds; single-use exchange code

/**
 * Social login controller, generic over identity providers (/users/auth/sso/:provider/*).
 * The provider translates its protocol (CAS ticket, OAuth2 code...) into a normalized
 * profile; everything else (account resolution, one-time code, JWT) is common.
 */
class SSOController {
  private authProviderService: AuthProviderService;
  private cacheService: CacheService;

  constructor() {
    this.authProviderService = container.resolve('authProviderService');
    this.cacheService = container.resolve('cacheService');
    this.initiate = this.initiate.bind(this);
    this.callback = this.callback.bind(this);
    this.exchange = this.exchange.bind(this);
  }

  async initiate(req: any, res: any) {
    const provider = getProvider(req.params.provider);
    if (!provider) {
      return res.status(404).json({ error: 'Unknown identity provider' });
    }

    // Every provider carries this transaction id back. OAuth2 uses native `state`;
    // CAS embeds it in the exact service callback URL.
    const state = crypto.randomBytes(16).toString('hex');
    await this.cacheService.set(
      `${SSO_FLOW_CACHE_PREFIX}${state}`,
      { action: 'login' } satisfies SsoFlow,
      SSO_FLOW_TTL_SECONDS
    );
    return res.redirect(provider.buildLoginUrl(state));
  }

  async callback(req: any, res: any) {
    const provider = getProvider(req.params.provider);
    if (!provider) {
      return res.redirect(`${FRONTEND_URL()}/sso/callback?sso_error=unknown_provider`);
    }

    let flow: SsoFlow | null = null;
    try {
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      flow = state
        ? await this.cacheService.get(`${SSO_FLOW_CACHE_PREFIX}${state}`)
        : null;
      if (!flow) {
        return res.redirect(`${FRONTEND_URL()}/sso/callback?sso_error=invalid_state`);
      }
      await this.cacheService.del(`${SSO_FLOW_CACHE_PREFIX}${state}`); // single use

      const profile = await provider.handleCallback(req.query);
      if (!profile) {
        return res.redirect(`${FRONTEND_URL()}/sso/callback?sso_error=invalid_response`);
      }

      if (flow.action === 'link') {
        if (flow.provider !== req.params.provider) {
          return res.redirect(`${FRONTEND_URL()}/me/settings?section=integrations&identity_error=invalid_state`);
        }
        await this.authProviderService.linkIdentity(flow.userId, profile);
        return res.redirect(
          `${FRONTEND_URL()}/me/settings?section=integrations&identity_linked=${encodeURIComponent(req.params.provider)}`
        );
      }

      const { token } = await this.authProviderService.findOrCreateUser(profile);

      // Never expose the JWT in a redirect URL: hand out a short-lived single-use
      // code instead, which the frontend exchanges through a direct API call.
      const code = crypto.randomBytes(16).toString('hex');
      await this.cacheService.set(`sso:code:${code}`, { token }, SSO_CODE_TTL);

      return res.redirect(`${FRONTEND_URL()}/sso/callback?code=${code}`);
    } catch (err: any) {
      console.error('[SSO] callback error:', err);
      if (flow?.action === 'link') {
        const errorCode = err instanceof IdentityOwnedByAnotherAccountError
          ? 'identity_in_use'
          : String(err?.message).toLowerCase().includes('disconnect the current')
            ? 'provider_already_connected'
            : 'server_error';
        return res.redirect(
          `${FRONTEND_URL()}/me/settings?section=integrations&identity_error=${errorCode}`
        );
      }
      return res.redirect(`${FRONTEND_URL()}/sso/callback?sso_error=server_error`);
    }
  }

  async exchange(req: any, res: any) {
    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ error: 'Missing code parameter' });
    }

    try {
      const data = await this.cacheService.get(`sso:code:${code}`);
      if (!data) {
        return res.status(401).json({ error: 'Invalid or expired SSO code' });
      }

      await this.cacheService.del(`sso:code:${code}`); // single use
      return res.json({ token: data.token });
    } catch (err: any) {
      const { status, message } = handleError(err);
      return res.status(status).json({ error: message });
    }
  }
}

export default SSOController;
