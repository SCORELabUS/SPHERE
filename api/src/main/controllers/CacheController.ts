import container from '../config/container';
import CacheService, { isServerCacheKey } from '../services/CacheService';
import { handleError } from '../utils/users/helpers';
import { OAUTH_CACHE_PREFIX } from '../services/OAuthService';

class CacheController {
  private cacheService: CacheService;
  private allowedOrigins = new Set(['localhost', 'sphere.score.us.es']);

  constructor() {
    this.cacheService = container.resolve('cacheService');
    this.get = this.get.bind(this);
    this.set = this.set.bind(this);
    this.refuseServerKey = this.refuseServerKey.bind(this);
  }

  /**
   * Internal results, SSO/OAuth state and rate-limit counters share this cache.
   * Never expose or accept writes to those entries through the public endpoint.
   * OAuth consent requests and codes must remain protected from forgery.
   */
  private refuseServerKey(key: unknown, res: any): boolean {
    if (typeof key === 'string' && (isServerCacheKey(key) || key.trim().toLowerCase().startsWith(OAUTH_CACHE_PREFIX))) {
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
      if (this.refuseServerKey(key, res)) return;
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
      if (this.refuseServerKey(key, res)) return;

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
