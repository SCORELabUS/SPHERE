import { NextFunction, Request, Response } from 'express';
import container from '../config/container';

/** Something that counts hits in a window that expires on its own. */
export interface RateLimitCounter {
  incrementWindow(key: string, ttlSeconds: number): Promise<number>;
}

export interface RateLimitOptions {
  /** Keeps the counters of different limiters apart. */
  name: string;
  /** Requests a client may make in one window. 0 turns the limiter off. */
  max: number;
  windowSeconds: number;
  /** The bucket a request counts against, or null when it is not limited. */
  keyOf: (req: Request) => string | null;
  /** Defaults to the cache service, which keeps counters in Redis. */
  counter?: () => RateLimitCounter;
}

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
};

// The test suites make hundreds of requests from one address in a few seconds,
// so the limiters are off under Vitest unless a limit is set explicitly. Their
// behavior is covered by unit tests.
const defaultMax = (value: number) => (process.env.VITEST ? 0 : value);

/**
 * Fixed-window rate limiting. Counters live in Redis, so every instance of the
 * API shares them and a restart does not reset them.
 *
 * It fails open: if Redis cannot be reached, requests go through rather than
 * taking the whole API down with the cache.
 */
export const createRateLimiter = (options: RateLimitOptions) => {
  const counter = options.counter ?? (() => container.resolve('cacheService') as RateLimitCounter);

  return async (req: Request, res: Response, next: NextFunction) => {
    const bucket = options.max > 0 ? options.keyOf(req) : null;
    if (!bucket) {
      return next();
    }

    const window = Math.floor(Date.now() / (options.windowSeconds * 1000));
    const resetsIn = (window + 1) * options.windowSeconds - Math.floor(Date.now() / 1000);

    let count: number;
    try {
      count = await counter().incrementWindow(
        `ratelimit:${options.name}:${bucket}:${window}`,
        options.windowSeconds
      );
    } catch {
      return next();
    }

    res.setHeader('RateLimit-Limit', options.max);
    res.setHeader('RateLimit-Remaining', Math.max(0, options.max - count));
    res.setHeader('RateLimit-Reset', resetsIn);

    if (count > options.max) {
      res.setHeader('Retry-After', resetsIn);
      return res.status(429).json({
        error: `TOO MANY REQUESTS: Rate limit exceeded. Try again in ${resetsIn} seconds.`,
      });
    }

    return next();
  };
};

const AUTH_PATH = /\/users\/(login|register|password\/forgot|password\/reset|email-verification\/resend)$/;

/**
 * Every request counts against its user (or API key owner) when there is one,
 * and against its IP address otherwise. Keying on the user keeps a classroom
 * behind a single NAT address from sharing one budget.
 *
 * The default, 300 requests every 10 seconds, is far above what the UI makes
 * while browsing, and ORBIT is not affected: it calls the services in-process.
 */
export const apiRateLimiter = createRateLimiter({
  name: 'api',
  max: numberFromEnv('RATE_LIMIT_MAX_REQUESTS', defaultMax(300)),
  windowSeconds: numberFromEnv('RATE_LIMIT_WINDOW_SECONDS', 10) || 10,
  keyOf: req => {
    if (req.path.endsWith('/healthcheck')) {
      return null;
    }
    const user = (req as any).user;
    return user?.id ? `user:${user.id}` : `ip:${req.ip}`;
  },
});

/**
 * Logins, registrations and password resets get a tighter budget against
 * guessing. It is kept per address and account, so many students signing in
 * from the same network at once are not locked out.
 */
export const authRateLimiter = createRateLimiter({
  name: 'auth',
  max: numberFromEnv('AUTH_RATE_LIMIT_MAX_REQUESTS', defaultMax(10)),
  windowSeconds: numberFromEnv('AUTH_RATE_LIMIT_WINDOW_SECONDS', 300) || 300,
  keyOf: req => {
    if (req.method !== 'POST' || !AUTH_PATH.test(req.path)) {
      return null;
    }
    // A password reset carries a token rather than an account, and the token
    // must not end up in a Redis key, so those are counted per address.
    const account = String(req.body?.loginField ?? req.body?.email ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 254);
    return `${req.ip}:${account}`;
  },
});
