import crypto from 'crypto';
import container from '../config/container';
import AuthProviderService from '../services/AuthProviderService';
import CacheService from '../services/CacheService';
import { getProvider } from '../services/identity/providerRegistry';
import { ProviderName } from '../services/identity/IdentityProvider';
import {
  SSO_FLOW_CACHE_PREFIX,
  SSO_FLOW_TTL_SECONDS,
  SsoFlow,
} from '../services/identity/SsoFlow';
import { handleError } from '../utils/users/helpers';

class IdentityController {
  private authProviderService: AuthProviderService;
  private cacheService: CacheService;

  constructor() {
    this.authProviderService = container.resolve('authProviderService');
    this.cacheService = container.resolve('cacheService');
    this.index = this.index.bind(this);
    this.initiateLink = this.initiateLink.bind(this);
    this.unlink = this.unlink.bind(this);
    this.setPassword = this.setPassword.bind(this);
    this.changePassword = this.changePassword.bind(this);
  }

  private requireUserSession(req: any) {
    if (!req.user || req.authType !== 'token') {
      throw new Error('UNAUTHORIZED: A user session is required to manage sign-in methods');
    }
  }

  async index(req: any, res: any) {
    try {
      this.requireUserSession(req);
      res.json(await this.authProviderService.getAuthenticationMethods(req.user.id));
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).json({ error: message });
    }
  }

  async initiateLink(req: any, res: any) {
    try {
      this.requireUserSession(req);
      const provider = getProvider(req.params.provider);
      if (!provider) throw new Error('NOT FOUND: Unknown identity provider');

      const state = crypto.randomBytes(24).toString('hex');
      await this.cacheService.set(
        `${SSO_FLOW_CACHE_PREFIX}${state}`,
        {
          action: 'link',
          userId: req.user.id,
          provider: req.params.provider,
        } satisfies SsoFlow,
        SSO_FLOW_TTL_SECONDS
      );

      res.json({ url: provider.buildLoginUrl(state) });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).json({ error: message });
    }
  }

  async unlink(req: any, res: any) {
    try {
      this.requireUserSession(req);
      const provider = getProvider(req.params.provider);
      if (!provider) throw new Error('NOT FOUND: Unknown identity provider');
      res.json(await this.authProviderService.unlinkIdentity(req.user.id, provider.name as ProviderName));
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).json({ error: message });
    }
  }

  async setPassword(req: any, res: any) {
    try {
      this.requireUserSession(req);
      res.json(await this.authProviderService.setInitialPassword(req.user.id, req.body.password));
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).json({ error: message });
    }
  }

  async changePassword(req: any, res: any) {
    try {
      this.requireUserSession(req);
      res.json(
        await this.authProviderService.changePassword(
          req.user.id,
          req.body.currentPassword,
          req.body.newPassword
        )
      );
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).json({ error: message });
    }
  }

}

export default IdentityController;
