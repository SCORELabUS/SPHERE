import dotenv from 'dotenv';
import { RedisClientType } from 'redis';
dotenv.config();

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
