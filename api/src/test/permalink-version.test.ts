/**
 * Integration tests for version permanent links: `GET /permalinks/pricing/{pricingId}?version=…`.
 *
 * A version named by id or by exact name is kept in the location when the
 * caller may see it. Any other version (unknown, malformed, of another family,
 * or private and not readable by the caller) is ignored: the answer is
 * byte-for-byte the one for the link without a version.
 */

import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import request from 'supertest';
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

describe('Version permanent links', { timeout: 20000 }, () => {
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

  /** Creates one pricing family whose versions (`1.0.0`, `2.0.0`, …) have the given visibility. */
  const createFamily = async (organizationId: string, visibilities: boolean[]) => {
    const { serviceName } = await createPricingForOrganization({
      organizationId,
      version: '1.0.0',
      isPrivate: visibilities[0],
    });

    for (const [index, isPrivate] of visibilities.slice(1).entries()) {
      const version = `${index + 2}.0.0`;
      const fixture = await createValidPricingYaml(serviceName, version);
      generatedFilesToDelete.add(fixture.filePath);
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

    const slug = docs[0].slug as string;
    return {
      slug,
      pricingId: String(docs[0].pricingId),
      versionIds: Object.fromEntries(docs.map(doc => [doc.version, String(doc._id)])) as Record<string, string>,
      location: `/pricings/${organizationId}/${encodeURIComponent(slug)}`,
    };
  };

  const resolve = (pricingId: string, query?: string, token?: string) => {
    const call = request(app).get(`${BASE_PATH}/permalinks/pricing/${pricingId}${query === undefined ? '' : `?${query}`}`);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  };

  /** The answer must be exactly the one for the link without a version: body and ETag. */
  const expectSameAsWithoutVersion = async (pricingId: string, query: string, token?: string) => {
    const base = await resolve(pricingId, undefined, token);
    const response = await resolve(pricingId, query, token);
    expect(response.status).toBe(base.status);
    expect(response.body).toEqual(base.body);
    expect(response.headers.etag).toBe(base.headers.etag);
    if (response.status === 200) expect(response.body.location).not.toContain('version=');
    return response;
  };

  describe('Links without a version', () => {
    it('Return 200 and the same location as before, with no version.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { pricingId, location } = await createFamily(organizationId, [false, false]);

      const response = await resolve(pricingId);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ location });
      expect(response.headers['cache-control']).toBe('private, no-cache');
    });

    it('Return 404 to anonymous callers when every version is private, as before.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { pricingId } = await createFamily(organizationId, [true]);

      expect((await resolve(pricingId)).status).toBe(404);
    });
  });

  describe('Public versions', () => {
    it('Return the location with the version id when the link names a public version by id.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { pricingId, versionIds, location } = await createFamily(organizationId, [false, false, false]);

      const response = await resolve(pricingId, `version=${versionIds['2.0.0']}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ location: `${location}?version=${versionIds['2.0.0']}` });
    });

    it('Return the location with the version id when the link names a public version by its exact name.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { pricingId, versionIds, location } = await createFamily(organizationId, [false, false]);

      const response = await resolve(pricingId, 'version=1.0.0');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ location: `${location}?version=${versionIds['1.0.0']}` });
    });

    it('Answer 304 to a version link whose ETag is still current, and not to the link without version.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { pricingId, versionIds } = await createFamily(organizationId, [false, false]);

      const first = await resolve(pricingId, `version=${versionIds['1.0.0']}`);
      const again = await resolve(pricingId, `version=${versionIds['1.0.0']}`).set('If-None-Match', first.headers.etag);
      const other = await resolve(pricingId).set('If-None-Match', first.headers.etag);

      expect(again.status).toBe(304);
      expect(other.status).toBe(200);
    });
  });

  describe('Private versions', () => {
    it('Ignore a private version for anonymous callers, by id or by name, without revealing it.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { pricingId, versionIds, location } = await createFamily(organizationId, [false, true, false]);

      const byId = await expectSameAsWithoutVersion(pricingId, `version=${versionIds['2.0.0']}`);
      await expectSameAsWithoutVersion(pricingId, 'version=2.0.0');

      expect(byId.body).toEqual({ location });
      expect(JSON.stringify(byId.body)).not.toContain(versionIds['2.0.0']);
      expect(JSON.stringify(byId.body)).not.toContain('2.0.0');
    });

    it('Ignore a private version for a signed-in user outside the organization.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');
      const { pricingId, versionIds } = await createFamily(organizationId, [false, true]);

      await expectSameAsWithoutVersion(pricingId, `version=${versionIds['2.0.0']}`, outsider.token);
      await expectSameAsWithoutVersion(pricingId, 'version=2.0.0', outsider.token);
    });

    it('Ignore a private version for a MEMBER without permission on the pricing.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id!, organizationId, 'MEMBER');
      const { pricingId, versionIds } = await createFamily(organizationId, [false, true]);

      await expectSameAsWithoutVersion(pricingId, `version=${versionIds['2.0.0']}`, member.token);
    });

    it('Keep a private version for the OWNER of its organization.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { pricingId, versionIds, location } = await createFamily(organizationId, [false, true]);

      const byId = await resolve(pricingId, `version=${versionIds['2.0.0']}`, owner.token);
      const byName = await resolve(pricingId, 'version=2.0.0', owner.token);

      expect(byId.status).toBe(200);
      expect(byId.body).toEqual({ location: `${location}?version=${versionIds['2.0.0']}` });
      expect(byName.body).toEqual(byId.body);
    });

    it('Keep a private version for a MEMBER with GET permission on the pricing.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id!, organizationId, 'MEMBER');
      const { pricingId, versionIds, slug, location } = await createFamily(organizationId, [false, true]);
      await createEntityScopedPermission(member.id!, organizationId, slug, 'pricing', {
        GET: true, PUT: false, DELETE: false, CREATE: false,
      });

      const response = await resolve(pricingId, `version=${versionIds['2.0.0']}`, member.token);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ location: `${location}?version=${versionIds['2.0.0']}` });
    });

    it('Keep a private version for a global ADMIN.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { pricingId, versionIds, location } = await createFamily(organizationId, [false, true]);

      const response = await resolve(pricingId, `version=${versionIds['2.0.0']}`, adminUser.token);

      expect(response.body).toEqual({ location: `${location}?version=${versionIds['2.0.0']}` });
    });

    it('Return 404 for a version link of a fully private pricing to callers who may not see it.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');
      const { pricingId, versionIds } = await createFamily(organizationId, [true, true]);

      for (const token of [undefined, outsider.token]) {
        const response = await expectSameAsWithoutVersion(pricingId, `version=${versionIds['1.0.0']}`, token);
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Resource unavailable' });
      }
    });

    it('Keep the version of a fully private pricing for its OWNER.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { pricingId, versionIds, location } = await createFamily(organizationId, [true, true]);

      const response = await resolve(pricingId, 'version=1.0.0', owner.token);

      expect(response.body).toEqual({ location: `${location}?version=${versionIds['1.0.0']}` });
    });
  });

  describe('Unknown and malformed versions', () => {
    it('Ignore versions that do not exist in the family, without error.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { pricingId } = await createFamily(organizationId, [false, true]);
      const other = await createFamily(organizationId, [false]);

      for (const token of [undefined, owner.token]) {
        await expectSameAsWithoutVersion(pricingId, 'version=0123456789abcdef01234567', token);
        await expectSameAsWithoutVersion(pricingId, 'version=9.9.9', token);
        // A version of another family is not a version of this one.
        await expectSameAsWithoutVersion(pricingId, `version=${other.versionIds['1.0.0']}`, token);
        await expectSameAsWithoutVersion(pricingId, 'version=1.0.0'.toUpperCase().replace('.', '_'), token);
      }
    });

    it('Ignore empty, repeated, structured and oversized values with 200, never 500.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { pricingId, versionIds } = await createFamily(organizationId, [false, false]);
      const id = versionIds['1.0.0'];

      for (const query of [
        'version=',
        `version=${id}&version=${id}`,
        `version[]=${id}`,
        'version[$ne]=x',
        `version[$gt]=`,
        `version=${'a'.repeat(5000)}`,
        'version=%00',
        `version=${id.slice(0, 23)}`,
        `version=${id}zz`,
      ]) {
        const response = await expectSameAsWithoutVersion(pricingId, query);
        expect(response.status).toBe(200);
      }
    });

    it('Ignore the version on collection permanent links.', async () => {
      const response = await request(app).get(`${BASE_PATH}/permalinks/collection/0123456789abcdef01234567?version=1.0.0`);
      expect(response.status).toBe(404);
    });
  });
});
