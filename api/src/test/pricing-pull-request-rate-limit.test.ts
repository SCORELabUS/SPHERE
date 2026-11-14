import dotenv from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Before the app (and its limiters) are imported: the limiters are off under
// Vitest unless a limit is set.
vi.hoisted(() => {
  process.env.PRICING_PR_RATE_LIMIT_MAX_REQUESTS = '6';
  // Windows of 63 years, so the requests (a minute apart) all but never straddle two of them.
  process.env.PRICING_PR_RATE_LIMIT_WINDOW_SECONDS = '2000000000';
});

import { shutdownApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import appContainer from '../main/config/container';

dotenv.config();

describe('Rate limit of the pricing pull requests', { timeout: 30000 }, () => {
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');

  beforeAll(() => {
    testContainer.resolve('app');
  });

  afterAll(async () => {
    for (const username of usersToDelete) await deleteTestUser(username);
    usersToDelete.clear();
    await shutdownApp();
  });

  it('Counts each user\'s requests that compute pull requests, on every such route, and not the listings or renames (CA-99).', async () => {
    const app = testContainer.resolve('app');
    const { user } = await createAndLoginUser('USER');
    const { user: other } = await createAndLoginUser('USER');
    const cache = appContainer.resolve('cacheService');
    const counter = vi.spyOn(cache, 'incrementWindow');
    const realNow = Date.now.bind(Date);
    const clock = vi.spyOn(Date, 'now');
    try {
      const pricingId = '0123456789abcdef01234567';
      const pullRequestId = 'fedcba9876543210fedcba98';
      const source = { kind: 'text', pricingId, baseVersionId: pricingId, proposedYaml: 'saasName: x' };
      const url = (pathName = '') => `${BASE_PATH}/pricing-pull-requests${pathName}`;
      const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
      const propose = (token: string) => request(app).post(url()).set(bearer(token)).send({ title: 'Limited', source });

      for (let i = 0; i < 5; i++) {
        const listed = await request(app).get(url(`?pricingId=${pricingId}`)).set(bearer(user.token));
        expect(listed.status).toBe(404);
      }
      // An edit that only renames parses nothing and is not counted.
      for (let i = 0; i < 3; i++) {
        const renamed = await request(app).put(url(`/${pullRequestId}`)).set(bearer(user.token)).send({ title: 'Renamed' });
        expect(renamed.status).toBe(404);
      }
      expect(counter).not.toHaveBeenCalled();

      // Every request that parses or merges a proposal shares one budget: one of each fills it.
      const limited = [
        () => propose(user.token),
        () => request(app).post(url('/previews')).set(bearer(user.token)).send({ source }),
        () => request(app).put(url(`/${pullRequestId}`)).set(bearer(user.token)).send({ proposedYaml: 'saasName: x' }),
        () => request(app).post(url(`/${pullRequestId}/merge-preview`)).set(bearer(user.token)).send({ purpose: 'merge' }),
        () => request(app).post(url(`/${pullRequestId}/update`)).set(bearer(user.token)).send({ previewToken: 'x.y' }),
        () => request(app).post(url(`/${pullRequestId}/merge`)).set(bearer(user.token)).send({ previewToken: 'x.y', version: '2.0.0', private: false }),
      ];
      for (const [index, send] of limited.entries()) {
        expect((await send()).status, `request ${index}`).not.toBe(429);
        expect(counter, `request ${index}`).toHaveBeenCalledTimes(index + 1);
      }
      // A minute later: with a window of a minute, a new one could have started between both rounds.
      clock.mockImplementation(() => realNow() + 61_000);
      for (const [index, send] of limited.entries()) {
        const refused = await send();
        expect(refused.status, `request ${index}`).toBe(429);
        expect(refused.headers['ratelimit-limit']).toBe('6');
        expect(refused.body.error).toMatch(/^TOO MANY REQUESTS/);
      }
      clock.mockRestore();
      // One counter, the user's in a single window, whichever window that is.
      const keys = counter.mock.calls.map(([key]) => key);
      expect(keys).toHaveLength(limited.length * 2);
      expect(keys[0]).toMatch(new RegExp(`^ratelimit:pricing-pr:user:${user.id}:\\d+$`));
      expect(new Set(keys).size).toBe(1);
      // Another user has a budget of their own.
      expect((await propose(other.token)).status).toBe(404);
      expect(counter.mock.calls.at(-1)?.[0]).toMatch(new RegExp(`^ratelimit:pricing-pr:user:${other.id}:\\d+$`));
    } finally {
      clock.mockRestore();
      const keys = new Set(counter.mock.calls.map(([key]) => key));
      counter.mockRestore();
      // The counters would otherwise outlive the test by years, also when it fails.
      for (const key of keys) await cache.del(key);
    }
  });
});
