import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter, RateLimitCounter } from '../../main/middlewares/RateLimitMiddleware';

/** Counts in memory, the way Redis would within one window. */
const memoryCounter = () => {
  const counts = new Map<string, number>();
  const counter: RateLimitCounter = {
    incrementWindow: async (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
  return { counter, counts };
};

const mockResponse = () => {
  const res: any = { headers: {} as Record<string, unknown>, statusCode: 200, body: undefined };
  res.setHeader = (name: string, value: unknown) => {
    res.headers[name] = value;
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  return res;
};

const run = async (limiter: ReturnType<typeof createRateLimiter>, req: any) => {
  const res = mockResponse();
  const next = vi.fn();
  await limiter(req, res, next);
  return { res, next };
};

describe('createRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets requests through up to the limit and answers 429 after it', async () => {
    const { counter } = memoryCounter();
    const limiter = createRateLimiter({
      name: 'test',
      max: 2,
      windowSeconds: 10,
      keyOf: () => 'client',
      counter: () => counter,
    });

    const first = await run(limiter, {});
    const second = await run(limiter, {});
    const third = await run(limiter, {});

    expect(first.next).toHaveBeenCalled();
    expect(second.next).toHaveBeenCalled();
    expect(second.res.headers['RateLimit-Remaining']).toBe(0);
    expect(third.next).not.toHaveBeenCalled();
    expect(third.res.statusCode).toBe(429);
    expect(third.res.headers['Retry-After']).toBeGreaterThan(0);
    expect(third.res.body.error).toMatch(/TOO MANY REQUESTS/);
  });

  it('keeps a separate budget for each client', async () => {
    const { counter } = memoryCounter();
    const limiter = createRateLimiter({
      name: 'test',
      max: 1,
      windowSeconds: 10,
      keyOf: (req: any) => req.client,
      counter: () => counter,
    });

    await run(limiter, { client: 'a' });
    const otherClient = await run(limiter, { client: 'b' });
    const sameClient = await run(limiter, { client: 'a' });

    expect(otherClient.next).toHaveBeenCalled();
    expect(sameClient.res.statusCode).toBe(429);
  });

  it('starts counting again in the next window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T10:00:00Z'));
    const { counter } = memoryCounter();
    const limiter = createRateLimiter({
      name: 'test',
      max: 1,
      windowSeconds: 10,
      keyOf: () => 'client',
      counter: () => counter,
    });

    await run(limiter, {});
    vi.setSystemTime(new Date('2026-10-24T10:00:10Z'));
    const nextWindow = await run(limiter, {});

    expect(nextWindow.next).toHaveBeenCalled();
  });

  it('does not count requests the key function leaves out', async () => {
    const { counter, counts } = memoryCounter();
    const limiter = createRateLimiter({
      name: 'test',
      max: 1,
      windowSeconds: 10,
      keyOf: () => null,
      counter: () => counter,
    });

    const response = await run(limiter, {});

    expect(response.next).toHaveBeenCalled();
    expect(counts.size).toBe(0);
  });

  it('is off when the limit is 0', async () => {
    const { counter, counts } = memoryCounter();
    const limiter = createRateLimiter({
      name: 'test',
      max: 0,
      windowSeconds: 10,
      keyOf: () => 'client',
      counter: () => counter,
    });

    const response = await run(limiter, {});

    expect(response.next).toHaveBeenCalled();
    expect(counts.size).toBe(0);
  });

  it('lets requests through when the counter fails', async () => {
    const limiter = createRateLimiter({
      name: 'test',
      max: 1,
      windowSeconds: 10,
      keyOf: () => 'client',
      counter: () => ({
        incrementWindow: async () => {
          throw new Error('ERROR: Redis client not initialized');
        },
      }),
    });

    const response = await run(limiter, {});

    expect(response.next).toHaveBeenCalled();
    expect(response.res.statusCode).toBe(200);
  });
});
