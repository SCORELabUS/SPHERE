import crypto from 'crypto';
import container from '../config/container';
import AuthProviderService from '../services/AuthProviderService';
import CacheService from '../services/CacheService';
import AccountMergeService from '../services/AccountMergeService';
import { getProvider } from '../services/identity/providerRegistry';
import { ProviderName } from '../services/identity/IdentityProvider';
import {
  ACCOUNT_MERGE_CACHE_PREFIX,
  AccountMergeChallenge,
  SSO_FLOW_CACHE_PREFIX,
  SSO_FLOW_TTL_SECONDS,
  SsoFlow,
} from '../services/identity/SsoFlow';
import { handleError } from '../utils/users/helpers';

class IdentityController {
  private authProviderService: AuthProviderService;
  private cacheService: CacheService;
  private accountMergeService: AccountMergeService;

  constructor() {
    this.authProviderService = container.resolve('authProviderService');
    this.cacheService = container.resolve('cacheService');
    this.accountMergeService = container.resolve('accountMergeService');
    this.index = this.index.bind(this);
    this.initiateLink = this.initiateLink.bind(this);
    this.unlink = this.unlink.bind(this);
    this.setPassword = this.setPassword.bind(this);
    this.previewMerge = this.previewMerge.bind(this);
    this.confirmMerge = this.confirmMerge.bind(this);
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

  private async getMergeChallenge(req: any): Promise<AccountMergeChallenge> {
    const challenge = await this.cacheService.get(`${ACCOUNT_MERGE_CACHE_PREFIX}${req.params.code}`);
    if (!challenge || challenge.targetUserId !== req.user.id) {
      throw new Error('NOT FOUND: Account merge request expired or is invalid');
    }
    return challenge;
  }

  async previewMerge(req: any, res: any) {
    try {
      this.requireUserSession(req);
      const challenge = await this.getMergeChallenge(req);
      res.json(await this.accountMergeService.preview(challenge.targetUserId, challenge.sourceUserId));
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).json({ error: message });
    }
  }

  async confirmMerge(req: any, res: any) {
    try {
      this.requireUserSession(req);
      const challenge = await this.getMergeChallenge(req);
      const result = await this.accountMergeService.merge(challenge.targetUserId, challenge.sourceUserId);
      await this.cacheService.del(`${ACCOUNT_MERGE_CACHE_PREFIX}${req.params.code}`);
      res.json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).json({ error: message });
    }
  }
}

export default IdentityController;
