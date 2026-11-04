/**
 * Integration tests for the public synchronization API (`/public/pricings`).
 *
 * Anonymous callers only ever see public versions. A caller authenticated with
 * a token or an API key who may read the pricing also gets its private
 * versions, flagged `private: true`, and those responses are never cacheable
 * by shared caches.
 */

import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import request from 'supertest';
import unzipper from 'unzipper';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { createAndLoginUser, createTestUser, deleteTestUser } from './utils/users/userTestUtils';
import { createPricingForOrganization, createValidPricingYaml } from './utils/pricings/pricingTestUtils';
import { createMembership } from './utils/organizations';
import { createEntityScopedPermission } from './utils/organizations/organizationTestUtils';
import { LeanUser } from '../main/types/models/User';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';

dotenv.config();

describe('Public synchronization API', { timeout: 20000 }, () => {
  let app: TestApp;
  const adminUser: LeanUser = testContainer.resolve('adminUser');
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const pricingsToDelete: Set<string> = testContainer.resolve('pricingsToDelete');
  const generatedFilesToDelete: Set<string> = testContainer.resolve('generatedFilesToDelete');

  beforeAll(async () => {
    app = testContainer.resolve('app');
  });

  afterEach(async () => {
    for (const username of usersToDelete) {
      await deleteTestUser(username);
    }
    usersToDelete.clear();

    for (const pricingId of pricingsToDelete) {
      await PricingMongoose.deleteOne({ _id: pricingId });
    }
    pricingsToDelete.clear();

    for (const filePath of generatedFilesToDelete) {
      await fs.rm(filePath, { force: true });
    }
    generatedFilesToDelete.clear();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  /**
   * Creates one pricing whose versions have the given visibility, oldest first,
   * and pins their createdAt so "newest" does not depend on the fixture dates.
   */
  const createMixedPricing = async (organizationId: string, visibilities: boolean[]) => {
    const { serviceName } = await createPricingForOrganization({
      organizationId,
      version: '1.0.0',
      isPrivate: visibilities[0],
    });

    for (const [index, isPrivate] of visibilities.slice(1).entries()) {
      const version = `${index + 2}.0.0`;
      const fixture = await createValidPricingYaml(serviceName, version);
      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${version}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .field('private', String(isPrivate))
        .attach('yaml', fixture.filePath);
      if (response.status !== 200) {
        throw new Error(`Version creation failed with ${response.status}: ${JSON.stringify(response.body)}`);
      }
    }

    const docs = await PricingMongoose.find({ name: serviceName, _organizationId: organizationId }).sort({ version: 1 });
    for (const [index, doc] of docs.entries()) {
      await PricingMongoose.updateOne({ _id: doc._id }, { createdAt: new Date(Date.UTC(2020, 0, index + 1)) });
      pricingsToDelete.add(doc._id.toString());
    }

    return {
      serviceName,
      slug: docs[0].slug as string,
      pricingId: String(docs[0].pricingId),
      versionIds: Object.fromEntries(docs.map(doc => [doc.version, String(doc._id)])) as Record<string, string>,
    };
  };

  const createKey = async (user: any, organizationId: string, scope: 'ALL' | 'MANAGEMENT' | 'VIEW') => {
    const response = await request(app)
      .post(`${BASE_PATH}/users/${user.username}/api-keys`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'sync', scopes: [{ organizationId, scope }] });
    expect(response.status).toBe(201);
    return response.body.plainKey as string;
  };

  const manifestUrl = (pricingId: string) => `${BASE_PATH}/public/pricings/${pricingId}`;
  const yamlUrl = (pricingId: string, versionId: string) =>
    `${BASE_PATH}/public/pricings/${pricingId}/versions/${versionId}/yaml`;
  const versionsOf = (body: any) => body.versions.map((v: any) => v.version);

  describe('GET /public/pricings/{pricingId}', () => {
    it('Return 200 and only public versions, without private flags, to anonymous callers.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { pricingId, versionIds } = await createMixedPricing(organizationId, [false, true, false, true]);

      const response = await request(app).get(manifestUrl(pricingId));

      expect(response.status).toBe(200);
      expect(versionsOf(response.body)).toEqual(['3.0.0', '1.0.0']);
      expect(response.body.latestVersionId).toBe(versionIds['3.0.0']);
      expect(response.body.versions.some((v: any) => 'private' in v)).toBe(false);
      expect(response.headers['cache-control']).toBe('private, no-cache');
      expect(String(response.headers.vary).toLowerCase()).toContain('authorization');
    });

    it('Return 200 and private versions flagged as private to the OWNER, never cacheable.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { pricingId, versionIds } = await createMixedPricing(organizationId, [false, true, false, true]);

      const response = await request(app).get(manifestUrl(pricingId)).set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(versionsOf(response.body)).toEqual(['4.0.0', '3.0.0', '2.0.0', '1.0.0']);
      expect(response.body.versions.map((v: any) => v.private === true)).toEqual([true, false, true, false]);
      expect(response.body.versions.filter((v: any) => !v.private).every((v: any) => !('private' in v))).toBe(true);
      expect(response.body.latestVersionId).toBe(versionIds['4.0.0']);
      expect(response.body.versions.every((v: any) => /^[0-9a-f]{64}$/.test(v.contentHash))).toBe(true);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(String(response.headers.vary).toLowerCase()).toContain('authorization');
      expect(String(response.headers.vary).toLowerCase()).toContain('x-api-key');
    });

    it('Apply the API key scope: OWNER keys with ALL or MANAGEMENT see private versions, a VIEW key reads as MEMBER.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');
      const { pricingId, slug } = await createMixedPricing(organizationId, [false, true]);
      await createEntityScopedPermission(member.id, organizationId, slug, 'pricing', {
        GET: true, PUT: false, DELETE: false, CREATE: false,
      });

      for (const scope of ['ALL', 'MANAGEMENT'] as const) {
        const response = await request(app).get(manifestUrl(pricingId)).set('x-api-key', await createKey(owner, organizationId, scope));
        expect(response.status, scope).toBe(200);
        expect(versionsOf(response.body), scope).toEqual(['2.0.0', '1.0.0']);
        expect(response.body.versions[0].private, scope).toBe(true);
        expect(response.headers['cache-control'], scope).toBe('private, no-store');
      }

      // VIEW makes the effective role MEMBER (SPHERE's scope model): the OWNER's
      // VIEW key only sees public versions...
      const ownerView = await request(app).get(manifestUrl(pricingId)).set('x-api-key', await createKey(owner, organizationId, 'VIEW'));
      expect(ownerView.status).toBe(200);
      expect(versionsOf(ownerView.body)).toEqual(['1.0.0']);

      // ...while a MEMBER with GET permission on the pricing keeps it through a VIEW key.
      const memberView = await request(app).get(manifestUrl(pricingId)).set('x-api-key', await createKey(member, organizationId, 'VIEW'));
      expect(memberView.status).toBe(200);
      expect(versionsOf(memberView.body)).toEqual(['2.0.0', '1.0.0']);
    });

    it('Return 200 and only public versions to an API key scoped to another organization.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { organizationId: otherOrganizationId } = await createTestUser('USER');
      await createMembership(owner.id, otherOrganizationId, 'OWNER');
      const { pricingId } = await createMixedPricing(organizationId, [false, true]);
      const key = await createKey(owner, otherOrganizationId, 'ALL');

      const response = await request(app).get(manifestUrl(pricingId)).set('x-api-key', key);

      expect(response.status).toBe(200);
      expect(versionsOf(response.body)).toEqual(['1.0.0']);
      expect(response.body.versions.some((v: any) => 'private' in v)).toBe(false);
      expect(response.headers['cache-control']).toBe('private, no-store');
    });

    it('Return 200 and only public versions to a MEMBER without GET permission, and all of them with it.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');
      const { pricingId, slug } = await createMixedPricing(organizationId, [false, true]);

      const without = await request(app).get(manifestUrl(pricingId)).set('Authorization', `Bearer ${member.token}`);
      expect(without.status).toBe(200);
      expect(versionsOf(without.body)).toEqual(['1.0.0']);

      await createEntityScopedPermission(member.id, organizationId, slug, 'pricing', {
        GET: true, PUT: false, DELETE: false, CREATE: false,
      });

      const withPermission = await request(app).get(manifestUrl(pricingId)).set('Authorization', `Bearer ${member.token}`);
      expect(withPermission.status).toBe(200);
      expect(versionsOf(withPermission.body)).toEqual(['2.0.0', '1.0.0']);
    });

    it('Return 404 to anonymous callers and 200 to the OWNER for a pricing whose versions are all private.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { pricingId, versionIds } = await createMixedPricing(organizationId, [true, true]);

      expect((await request(app).get(manifestUrl(pricingId))).status).toBe(404);

      const response = await request(app).get(manifestUrl(pricingId)).set('Authorization', `Bearer ${owner.token}`);
      expect(response.status).toBe(200);
      expect(response.body.latestVersionId).toBe(versionIds['2.0.0']);
      expect(response.body.versions.every((v: any) => v.private === true)).toBe(true);
    });

    it('Return different ETags to anonymous and authorized callers, and 304 to an authorized revalidation.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { pricingId } = await createMixedPricing(organizationId, [false, true]);

      const anonymous = await request(app).get(manifestUrl(pricingId));
      const authorized = await request(app).get(manifestUrl(pricingId)).set('Authorization', `Bearer ${owner.token}`);
      expect(anonymous.headers.etag).toBeDefined();
      expect(authorized.headers.etag).not.toBe(anonymous.headers.etag);

      const revalidated = await request(app)
        .get(manifestUrl(pricingId))
        .set('Authorization', `Bearer ${owner.token}`)
        .set('If-None-Match', authorized.headers.etag);
      expect(revalidated.status).toBe(304);
      expect(revalidated.headers['cache-control']).toBe('private, no-store');

      const anonymousWithAuthorizedEtag = await request(app)
        .get(manifestUrl(pricingId))
        .set('If-None-Match', authorized.headers.etag);
      expect(anonymousWithAuthorizedEtag.status).toBe(200);
    });
  });

  describe('GET /public/pricings/{pricingId}/versions/{versionId}/yaml', () => {
    it('Return 404 for a private version to anonymous callers and to users who may not read it.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');
      const { pricingId, versionIds } = await createMixedPricing(organizationId, [false, true]);

      expect((await request(app).get(yamlUrl(pricingId, versionIds['2.0.0']))).status).toBe(404);
      expect(
        (await request(app).get(yamlUrl(pricingId, versionIds['2.0.0'])).set('Authorization', `Bearer ${outsider.token}`)).status
      ).toBe(404);
      expect((await request(app).get(yamlUrl(pricingId, versionIds['1.0.0']))).status).toBe(200);
    });

    it('Return 200 and the YAML of a private version to the OWNER and to an API key of the OWNER.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { pricingId, versionIds, serviceName } = await createMixedPricing(organizationId, [false, true]);
      const key = await createKey(owner, organizationId, 'MANAGEMENT');

      const byToken = await request(app).get(yamlUrl(pricingId, versionIds['2.0.0'])).set('Authorization', `Bearer ${owner.token}`);
      expect(byToken.status).toBe(200);
      expect(byToken.headers['content-type']).toContain('application/yaml');
      expect(byToken.text).toContain(`saasName: ${serviceName}`);
      expect(byToken.headers['cache-control']).toBe('private, no-store');

      const byKey = await request(app).get(yamlUrl(pricingId, versionIds['2.0.0'])).set('x-api-key', key);
      expect(byKey.status).toBe(200);
      expect(byKey.text).toBe(byToken.text);
    });
  });

  describe('GET /public/pricings/{pricingId}/download', () => {
    const entriesOf = async (response: request.Response) => {
      const archive = await unzipper.Open.buffer(response.body as Buffer);
      return archive.files.map(file => file.path).sort();
    };

    const downloadAs = (pricingId: string, headers: Record<string, string> = {}) => {
      const req = request(app)
        .get(`${BASE_PATH}/public/pricings/${pricingId}/download`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      for (const [name, value] of Object.entries(headers)) req.set(name, value);
      return req;
    };

    it('Return the public versions to an authenticated user who may not read the private ones.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');
      const { pricingId } = await createMixedPricing(organizationId, [false, true]);

      const response = await downloadAs(pricingId, { Authorization: `Bearer ${outsider.token}` });

      expect(response.status).toBe(200);
      expect(await entriesOf(response)).toHaveLength(1);
      expect(response.headers['cache-control']).toBe('private, no-store');
    });

    it('Return every version to the OWNER and only public ones to anonymous callers.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { pricingId } = await createMixedPricing(organizationId, [false, true]);

      const anonymous = await downloadAs(pricingId);
      expect(anonymous.status).toBe(200);
      expect(await entriesOf(anonymous)).toHaveLength(1);

      const authorized = await downloadAs(pricingId, { Authorization: `Bearer ${owner.token}` });
      expect(authorized.status).toBe(200);
      expect(await entriesOf(authorized)).toHaveLength(2);
    });
  });
});
