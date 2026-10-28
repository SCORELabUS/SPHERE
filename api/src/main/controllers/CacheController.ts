import container from '../config/container';
import CacheService from '../services/CacheService';
import { handleError } from '../utils/users/helpers';
import { OAUTH_CACHE_PREFIX } from '../services/OAuthService';

class CacheController {
  private cacheService: CacheService;
  private allowedOrigins = new Set(['localhost', 'sphere.score.us.es']);

  constructor() {
    this.cacheService = container.resolve('cacheService');
    this.get = this.get.bind(this);
    this.set = this.set.bind(this);
    this.refuseOAuthKey = this.refuseOAuthKey.bind(this);
  }

  /**
   * OAuthService keeps consent requests and authorization codes in the same
   * cache: writing one here would forge an approval for any user, so those
   * keys are never read or written through this endpoint (keys are case-insensitive).
   */
  private refuseOAuthKey(key: unknown, res: any): boolean {
    if (typeof key === 'string' && key.trim().toLowerCase().startsWith(OAUTH_CACHE_PREFIX)) {
      res.status(403).send({ error: 'PERMISSION ERROR: This cache key is reserved for the server' });
      return true;
    }
    return false;
  }

  async get(req: any, res: any) {
    try {
      const originHeader = req.headers['x-origin'] || req.headers.origin;
      let hostname: string | null = null;

      if (originHeader) {
        try {
          hostname = new URL(originHeader).hostname;
        } catch {
          hostname = null;
        }
      }

      const isAllowedOrigin = hostname && this.allowedOrigins.has(hostname);
      const isAdmin = req.user?.role === 'ADMIN';

      if (!isAllowedOrigin && !isAdmin) {
        return res.status(403).send({ error: 'PERMISSION ERROR: You are not allowed to access this resource. Either call this endpoint from a local environment, sphere.score.us.es, or login as ADMIN' });
      }

      const { key } = req.query;
      if (this.refuseOAuthKey(key, res)) return;
      const data = await this.cacheService.get(key);

      res.status(200).json(data);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async set(req: any, res: any) {
    try {
      const originHeader = req.headers['x-origin'] || req.headers.origin;
      let hostname: string | null = null;

      if (originHeader) {
        try {
          hostname = new URL(originHeader).hostname;
        } catch {
          hostname = null;
        }
      }

      const isAllowedOrigin = hostname && this.allowedOrigins.has(hostname);

      const isAdmin = req.user?.role === 'ADMIN';

      if (!isAllowedOrigin && !isAdmin) {
        return res.status(403).send({ error: 'PERMISSION ERROR: You are not allowed to access this resource. Either call this endpoint from a local environment, sphere.score.us.es, or login as ADMIN' });
      }

      const { key, value, expirationInSeconds } = req.body;
      if (this.refuseOAuthKey(key, res)) return;

      if (!expirationInSeconds) {
        await this.cacheService.set(key, value);
      } else {
        await this.cacheService.set(key, value, expirationInSeconds);
      }

      res.status(200).send({ message: 'Cache set successfully' });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }
}

export default CacheController;
