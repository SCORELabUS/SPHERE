import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import { createAndLoginUser, createTestUser, deleteTestUser } from './utils/users/userTestUtils';
import { LeanUser } from '../main/types/models/User';
import { BASE_PATH, TEST_PASSWORD } from './utils/config/variables';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import testContainer from './utils/config/testContainer';
import {
  createAndTrackPricingYaml,
  createPricingForOrganization,
  createValidPricingYaml,
} from './utils/pricings/pricingTestUtils';
import {
  createCollectionForOrganization,
  createTestCollectionWithPricings,
} from './utils/collections/collectionTestUtils';
import { randomSuffix } from './utils/helpers';
import { createOrgScopedPermission, createMembership } from './utils/organizations';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import { createEntityScopedPermission } from './utils/organizations/organizationTestUtils';

dotenv.config();

describe('Pricings API integration', () => {
  let app: TestApp;
  const adminUser: LeanUser = testContainer.resolve('adminUser');
  const testUser: LeanUser = testContainer.resolve('testUser');
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const pricingsToDelete: Set<string> = testContainer.resolve('pricingsToDelete');
  const generatedFilesToDelete: Set<string> = testContainer.resolve('generatedFilesToDelete');
  const collectionIdsToDelete: Set<string> = testContainer.resolve('collectionIdsToDelete');

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

    for (const collectionId of collectionIdsToDelete) {
      await PricingCollectionMongoose.deleteOne({ _id: collectionId });
    }
    collectionIdsToDelete.clear();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  describe('GET /api/v1/pricings', () => {
    it('Return 200 and paginated pricing list with valid Bearer Authorization header.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      for (let i = 0; i < 5; i++) {
        await createPricingForOrganization({
          organizationId: organizationId,
          isPrivate: false,
        });
      }

      const response = await request(app).get(`${BASE_PATH}/pricings?limit=3&offset=0`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      if (response.body.total !== undefined) {
        expect(typeof response.body.total).toBe('number');
      }
      expect(response.body.pricings.length).toBe(3);
    });

    it('Return 200 and filtered/sorted pricing list when query parameters are provided.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const testPricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const response = await request(app).get(
        `${BASE_PATH}/pricings?name=${testPricing.serviceName}&limit=5&offset=0`
      );

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(typeof response.body.total).toBe('number');
      expect(response.body.pricings.length).toBe(1);
    });

    it('Return 200 and only PUBLIC pricings if unauthenticated user make the request.', async () => {
      const { organizationId } = await createTestUser('USER');

      const publicPricing = await createPricingForOrganization({
        organizationId: organizationId,
        isPrivate: false,
      });

      await createPricingForOrganization({
        organizationId: organizationId,
        isPrivate: true,
      });

      const response = await request(app).get(`${BASE_PATH}/pricings`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(typeof response.body.total).toBe('number');
      expect(response.body.pricings.length).toBe(1);
      expect(response.body.pricings[0].name).toBe(publicPricing.serviceName);
    });

    it('Return 200 and only PUBLIC pricings if USER make the request.', async () => {
      const { organizationId } = await createTestUser('USER');

      const publicPricing = await createPricingForOrganization({
        organizationId: organizationId,
        isPrivate: false,
      });

      await createPricingForOrganization({
        organizationId: organizationId,
        isPrivate: true,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings`)
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(typeof response.body.total).toBe('number');
      expect(response.body.pricings.length).toBe(1);
      expect(response.body.pricings[0].name).toBe(publicPricing.serviceName);
    });

    it('Return 200 and all pricings if ADMIN make the request.', async () => {
      const { organizationId } = await createTestUser('USER');

      const publicPricing = await createPricingForOrganization({
        organizationId: organizationId,
        isPrivate: false,
      });

      const privatePricing = await createPricingForOrganization({
        organizationId: organizationId,
        isPrivate: true,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(typeof response.body.total).toBe('number');
      expect(response.body.pricings.length).toBeGreaterThanOrEqual(2);
      const pricingNames = response.body.pricings.map((p: any) => p.name);
      expect(pricingNames).toContain(publicPricing.serviceName);
      expect(pricingNames).toContain(privatePricing.serviceName);
    });
  });

  describe('PUT /api/v1/pricings', () => {
    it('Return 200 and updated pricing object when sending a valid pricing YAML string.', async () => {
      const serviceName = `updated_pricing_${randomSuffix()}`;
      const version = `3.1.${Math.floor(Math.random() * 1000)}`;
      const filePath = await createAndTrackPricingYaml(serviceName, version);
      const pricingYaml = await fs.readFile(filePath, 'utf8');

      const response = await request(app)
        .put(`${BASE_PATH}/pricings`)
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({ pricing: pricingYaml });

      expect(response.status).toBe(200);
      expect(response.body.version).toBeDefined();
      expect(response.body.features).toBeDefined();
      expect(response.body.usageLimits).toBeDefined();
      expect(response.body.plans).toBeDefined();
    });

    it('Return 200 and updated pricing object with unauthenticated user.', async () => {
      const serviceName = `updated_pricing_${randomSuffix()}`;
      const version = `3.1.${Math.floor(Math.random() * 1000)}`;
      const filePath = await createAndTrackPricingYaml(serviceName, version);
      const pricingYaml = await fs.readFile(filePath, 'utf8');

      const response = await request(app)
        .put(`${BASE_PATH}/pricings`)
        .send({ pricing: pricingYaml });

      expect(response.status).toBe(200);
      expect(response.body.version).toBeDefined();
      expect(response.body.features).toBeDefined();
      expect(response.body.usageLimits).toBeDefined();
      expect(response.body.plans).toBeDefined();
    });

    it('Return 422 with malformed pricing text (must not return 500).', async () => {
      const response = await request(app)
        .put(`${BASE_PATH}/pricings`)
        .set('Authorization', `Bearer ${testUser.token}`)
        .send({ pricing: '::::invalid-yaml::::' });

      expect(response.status).toBe(422);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/v1/pricings/:organizationId', () => {
    it('Return 200 and pricing list with owner requesting own username.', async () => {
      const { user: owner, organizationId } = await createTestUser('USER');

      await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBeGreaterThanOrEqual(1);
    });

    it('Return 200 and public pricing list with regular user requesting an organization they are not member of.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: requester } = await createAndLoginUser('USER');

      await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(1);
    });

    it('Return 200 and list with all public a certain private pricings with MEMBER with scoped permissions requesting.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      await createEntityScopedPermission(member.id, organizationId, pricing.id, 'pricing', {
        GET: true,
        PUT: false,
        DELETE: false,
        CREATE: false,
      });

      await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(1);
      expect(response.body.pricings[0].id).toBe(pricing.id);
    });

    it('Return 200 and list with exactly 5 pricings with MEMBER with scoped permissions requesting.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      for (let i = 0; i < 3; i++) {
        await createPricingForOrganization({
          organizationId,
          isPrivate: true,
        });
      }

      for (let i = 0; i < 5; i++) {
        await createPricingForOrganization({
          organizationId,
          isPrivate: false,
        });
      }

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}?limit=5&offset=0`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(5);
      expect(response.body.pricings.every((p: any) => !p.isPrivate)).toBe(true);
    });

    it('Return 200 and public/private pricing list with ADMIN user requesting random organization.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: requester } = await createAndLoginUser('ADMIN');

      await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(2);
    });

    it('Return 200 with pricings in collection.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: requester } = await createAndLoginUser('ADMIN');

      const pricingInCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createPricingForOrganization({
        organizationId: organizationId,
      });

      await createTestCollectionWithPricings({ _organizationId: organizationId }, [
        pricingInCollection.serviceName,
      ]);

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(2);
    });

    it('Return 200 with pricings in collections.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: requester } = await createAndLoginUser('ADMIN');

      const pricingInCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createTestCollectionWithPricings({ _organizationId: organizationId }, [
        pricingInCollection.serviceName,
      ]);

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}?includePricingsInCollection=true`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(2);
    });

    it('Return 200 and filter pricings by collection with spaces in name', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const pricingInCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const collection = await createTestCollectionWithPricings(
        { _organizationId: organizationId, name: 'IEEE TSC 2025' },
        [pricingInCollection.serviceName]
      );

      const response = await request(app)
        .get(
          `${BASE_PATH}/pricings?collection=${encodeURIComponent(collection.slug || 'ieee-tsc-2025')}`
        )
        .set('Authorization', `Bearer ${(await createAndLoginUser('USER')).user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(1);
      expect(response.body.pricings[0].name).toBe(pricingInCollection.serviceName);
    });
  });

  describe('POST /api/v1/pricings/:organizationId', () => {
    it('Return 200 and pricing object when owner uploads valid pricing YAML.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const fixture = await createValidPricingYaml(`pricing_${randomSuffix()}`);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('private', 'false')
        .field('saasName', fixture.saasName)
        .field('version', fixture.version)
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name ?? response.body[0]?.name).toBe(fixture.saasName);
    });

    it('Return 403 with USER role trying to create pricing for another user.', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { organizationId: otherOrganizationId } = await createTestUser('USER');

      const filePath = await createAndTrackPricingYaml(`pricing_${randomSuffix()}`);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${otherOrganizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('private', 'false')
        .attach('yaml', filePath);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('Return 422 and validation errors object with missing private field.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('saasName', `pricing_${randomSuffix()}`);

      expect(response.status).toBe(422);
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('Return 401 and error object with missing Authorization header.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .field('private', 'false');

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });

    it('Return 200 when MEMBER with CREATE permission uploads valid pricing YAML.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      // Add member to owner's org
      await createMembership(member.id, organizationId, 'MEMBER');

      // Grant CREATE permission to member
      await createOrgScopedPermission(member.id, organizationId, 'pricing', {
        GET: false,
        PUT: false,
        DELETE: false,
        CREATE: true,
      });

      const fixture = await createValidPricingYaml(`pricing_${randomSuffix()}`);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .field('private', 'false')
        .field('saasName', fixture.saasName)
        .field('version', fixture.version)
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name ?? response.body[0]?.name).toBe(fixture.saasName);
    });

    it('Return 403 when MEMBER without CREATE permission tries to create pricing.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      // Add member to owner's org (no CREATE permission granted)
      await createMembership(member.id, organizationId, 'MEMBER');

      const fixture = await createValidPricingYaml(`pricing_${randomSuffix()}`);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .field('private', 'false')
        .field('saasName', fixture.saasName)
        .field('version', fixture.version)
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('Return 200 when OWNER creates pricing (bypasses CREATE check).', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const fixture = await createValidPricingYaml(`pricing_${randomSuffix()}`);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('private', 'false')
        .field('saasName', fixture.saasName)
        .field('version', fixture.version)
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name ?? response.body[0]?.name).toBe(fixture.saasName);
    });

    it('Return 200 when global ADMIN creates pricing (bypasses CREATE check).', async () => {
      const { organizationId } = await createTestUser('USER');

      const fixture = await createValidPricingYaml(`pricing_${randomSuffix()}`);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .field('private', 'false')
        .field('saasName', fixture.saasName)
        .field('version', fixture.version)
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name ?? response.body[0]?.name).toBe(fixture.saasName);
    });

    it('Return 403 when user not in org tries to create pricing.', async () => {
      const { user: outsider } = await createAndLoginUser('USER');
      const { organizationId } = await createAndLoginUser('USER');

      const fixture = await createValidPricingYaml(`pricing_${randomSuffix()}`);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .field('private', 'false')
        .field('saasName', fixture.saasName)
        .field('version', fixture.version)
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/v1/pricings/:organizationId/:pricingName', () => {
    it('Return 200 and pricing details with owner requesting own pricing.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${serviceName}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(serviceName);
      expect(Array.isArray(response.body.versions)).toBe(true);
    });

    it('Return 200 and pricing details with admin requesting another user pricing.', async () => {
      const { organizationId } = await createTestUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${serviceName}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(serviceName);
      expect(Array.isArray(response.body.versions)).toBe(true);
    });

    it('Return 404 with regular user requesting private pricing from another user.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: requester } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${serviceName}`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('Return 404 and error object with non-existing pricing name.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/nonexistent_pricing`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/v1/pricings/:organizationId/:pricingName/:pricingVersion', () => {
    it('Return 200 and configuration space with non authenticated request over public pricing.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const { serviceName, version } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const response = await request(app).get(
        `${BASE_PATH}/pricings/${organizationId}/${serviceName}/${version}`
      );

      expect(response.status).toBe(200);
      expect(response.body.configurationSpace).toBeDefined();
      expect(response.body.configurationSpaceSize).toBeGreaterThan(0);
    });

    it('Return 200 and configuration space with USER request over public pricing.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const { serviceName, version } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${version}`)
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.configurationSpace).toBeDefined();
      expect(response.body.configurationSpaceSize).toBeGreaterThan(0);
    });

    it('Return 200 and configuration space with ADMIN request over private pricing.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const { serviceName, version } = await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${version}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.configurationSpace).toBeDefined();
      expect(response.body.configurationSpaceSize).toBeGreaterThan(0);
    });

    it('Return 200 and configuration space with owner request over private pricing.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { serviceName, version } = await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${version}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.configurationSpace).toBeDefined();
      expect(response.body.configurationSpaceSize).toBeGreaterThan(0);
    });

    it('Return 404 and configuration space with USER request over private pricing.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const { serviceName, version } = await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${version}`)
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('Return 404 and error object with non-existing pricing name.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/nonexistent_pricing`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('PUT /api/v1/pricings/:organizationId/:pricingName', () => {
    it('Return 200 and updated pricing details when owner updates metadata.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
      });

      const response = await request(app)
        .put(`${BASE_PATH}/pricings/${organizationId}/${serviceName}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ url: 'https://example.com/pricing' });

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.versions)).toBe(true);
    });

    it('Return 200 and updated pricing details when ADMIN updates another user pricing.', async () => {
      const { organizationId } = await createTestUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
      });

      const response = await request(app)
        .put(`${BASE_PATH}/pricings/${organizationId}/${serviceName}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ url: 'https://example.com/admin-update' });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(serviceName);
      expect(Array.isArray(response.body.versions)).toBe(true);
    });

    it('Return 403 with USER role trying to update another user pricing.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: requester } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
      });

      const response = await request(app)
        .put(`${BASE_PATH}/pricings/${organizationId}/${serviceName}`)
        .set('Authorization', `Bearer ${requester.token}`)
        .send({ private: true });

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('Return 422 and validation errors object with invalid url field.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
      });

      const response = await request(app)
        .put(`${BASE_PATH}/pricings/${organizationId}/${serviceName}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ url: 'not-a-url' });

      expect(response.status).toBe(422);
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('Return 404 and error object with non-existing pricing.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/pricings/${organizationId}/nonexistent_pricing`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ private: true });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('DELETE /api/v1/pricings/:organizationId/:pricingName', () => {
    it('Return 200 and success message when owner deletes own pricing.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
      });

      const response = await request(app)
        .delete(`${BASE_PATH}/pricings/${organizationId}/${serviceName}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBeDefined();
    });

    it('Return 200 and success message when ADMIN deletes another user pricing.', async () => {
      const { organizationId } = await createTestUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
      });

      const response = await request(app)
        .delete(`${BASE_PATH}/pricings/${organizationId}/${serviceName}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBeDefined();
    });

    it('Return 403 with USER role trying to delete another user pricing.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: requester } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
      });

      const response = await request(app)
        .delete(`${BASE_PATH}/pricings/${organizationId}/${serviceName}`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('Return 404 with non-existing pricing (must not return 500).', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .delete(`${BASE_PATH}/pricings/${organizationId}/nonexistent_pricing`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('DELETE /api/v1/pricings/:organizationId/:pricingName/:pricingVersion', () => {
    it('Return 200 and success message when owner deletes a specific pricing version.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const serviceName = `pricing_${randomSuffix()}`;
      const version = `2.0.${Math.floor(Math.random() * 1000)}`;
      await createPricingForOrganization({
        organizationId,
        serviceName,
        version,
      });

      const response = await request(app)
        .delete(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${version}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBeDefined();
    });

    it('Return 200 and success message when ADMIN deletes another user pricing version.', async () => {
      const { organizationId } = await createTestUser('USER');

      const serviceName = `pricing_${randomSuffix()}`;
      const version = `2.1.${Math.floor(Math.random() * 1000)}`;
      await createPricingForOrganization({
        organizationId,
        serviceName,
        version,
      });

      const response = await request(app)
        .delete(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${version}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBeDefined();
    });

    it('Return 403 with USER role trying to delete another user pricing version.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: requester } = await createAndLoginUser('USER');

      const serviceName = `pricing_${randomSuffix()}`;
      const version = `2.2.${Math.floor(Math.random() * 1000)}`;
      await createPricingForOrganization({
        organizationId,
        serviceName,
        version,
      });

      const response = await request(app)
        .delete(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${version}`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('Return 404 with non-existing pricing version (must not return 500).', async () => {
      const { organizationId } = await createTestUser('USER');

      const response = await request(app)
        .delete(`${BASE_PATH}/pricings/${organizationId}/nonexistent_pricing/9.9.9`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('Return 404 with existing pricing name but non-existing version.', async () => {
      const { organizationId } = await createTestUser('USER');

      const serviceName = `pricing_${randomSuffix()}`;
      await createPricingForOrganization({
        organizationId,
        serviceName,
        version: '1.0.0',
      });

      const response = await request(app)
        .delete(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/nonexistent_version`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });
});
