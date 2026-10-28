import dotenv from 'dotenv';
import { RedisClientType } from 'redis';
dotenv.config();

/** Prefix of the entries only the server reads and writes, such as computed configuration spaces. */
export const INTERNAL_CACHE_PREFIX = 'internal:';

/**
 * Prefixes of the server's own entries: its computed results, SSO login state
 * and rate-limit counters. The public `/cache` endpoint neither reads nor
 * writes keys under them.
 */
export const SERVER_CACHE_PREFIXES = [INTERNAL_CACHE_PREFIX, 'sso:', 'ratelimit:'] as const;

/** Whether a key belongs to the server's own entries (keys are case-insensitive). */
export function isServerCacheKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return SERVER_CACHE_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

class CacheService {
  private redisClient: RedisClientType | null = null;
  private readonly namespace = (process.env.REDIS_KEY_PREFIX ?? 'sphere:').replace(/:$/, '') + ':';

  constructor() {}

  setRedisClient(client: RedisClientType) {
    this.redisClient = client;
  }

  private key(value: string) {
    return `${this.namespace}${value.toLowerCase()}`;
  }

  async get(key: string) {
    if (!this.redisClient) {
      throw new Error('ERROR: Redis client not initialized');
    }

    const value = await this.redisClient?.get(this.key(key));

    return value ? JSON.parse(value) : null;
  }

  async del(key: string) {
    if (!this.redisClient) {
      throw new Error('ERROR: Redis client not initialized');
    }

    await this.redisClient.del(this.key(key));
  }

  /** Atomically consume short-lived secrets; GET followed by DEL permits replay. */
  async take(key: string) {
    if (!this.redisClient) throw new Error('ERROR: Redis client not initialized');
    const value = await this.redisClient.getDel(this.key(key));
    return value ? JSON.parse(value) : null;
  }

  async setIfAbsent(key: string, value: unknown, seconds: number): Promise<boolean> {
    if (!this.redisClient) throw new Error('ERROR: Redis client not initialized');
    return (await this.redisClient.set(this.key(key), JSON.stringify(value), { NX: true, EX: seconds })) === 'OK';
  }

  async set(key: string, value: any, expirationInSeconds?: number) {
    if (!this.redisClient) {
      throw new Error('ERROR: Redis client not initialized');
    }

    const previousValue = await this.redisClient?.get(this.key(key));
    if (previousValue && previousValue !== JSON.stringify(value)) {
      throw new Error('CONFLICT: Value already exists in cache, please use a different key.');
    }

    await this.redisClient?.set(this.key(key), JSON.stringify(value), {
      EX: expirationInSeconds ?? 300,
    });
  }

  /**
   * Adds one to a counter that disappears after `ttlSeconds`, and returns the
   * new count. The expiry is only set by the first increment, so the counter
   * covers a fixed window instead of being pushed back by every hit.
   */
  async incrementWindow(key: string, ttlSeconds: number): Promise<number> {
    if (!this.redisClient) {
      throw new Error('ERROR: Redis client not initialized');
    }

    const count = await this.redisClient.incr(this.key(key));
    if (count === 1) {
      await this.redisClient.expire(this.key(key), ttlSeconds);
    }

    return count;
  }
}

export default CacheService;
