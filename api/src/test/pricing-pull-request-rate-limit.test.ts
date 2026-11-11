import dotenv from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Before the app (and its limiters) are imported: the limiters are off under
// Vitest unless a limit is set.
vi.hoisted(() => {
  process.env.PRICING_PR_RATE_LIMIT_MAX_REQUESTS = '3';
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

  it('Counts each user\'s requests that compute pull requests, and not the listings (CA-99).', async () => {
    const app = testContainer.resolve('app');
    const { user } = await createAndLoginUser('USER');
    const { user: other } = await createAndLoginUser('USER');
    const counter = vi.spyOn(appContainer.resolve('cacheService'), 'incrementWindow');
    const pricingId = '0123456789abcdef01234567';
    const propose = (token: string) =>
      request(app)
        .post(`${BASE_PATH}/pricing-pull-requests`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Limited', source: { kind: 'text', pricingId, baseVersionId: pricingId, proposedYaml: 'saasName: x' } });

    for (let i = 0; i < 5; i++) {
      const listed = await request(app)
        .get(`${BASE_PATH}/pricing-pull-requests?pricingId=${pricingId}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(listed.status).toBe(404);
    }
    for (let i = 0; i < 3; i++) expect((await propose(user.token)).status).toBe(404);

    const fourth = await propose(user.token);
    expect(fourth.status).toBe(429);
    expect(fourth.headers['ratelimit-limit']).toBe('3');
    expect(fourth.body.error).toMatch(/^TOO MANY REQUESTS/);
    expect(counter.mock.calls.map(([key]) => key)).toEqual(
      Array(4).fill(expect.stringMatching(new RegExp(`^ratelimit:pricing-pr:user:${user.id}:\\d+$`)))
    );
    // Another user has a budget of their own.
    expect((await propose(other.token)).status).toBe(404);
    counter.mockRestore();
  });
});
