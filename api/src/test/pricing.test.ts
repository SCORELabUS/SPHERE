import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import request from 'supertest';
import yaml from 'js-yaml';
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
import { createOrgScopedPermission, createMembership, createTestOrganizationDirect } from './utils/organizations';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import EntityPermissionMongoose from '../main/repositories/mongoose/models/EntityPermissionMongoose';
import { createEntityScopedPermission } from './utils/organizations/organizationTestUtils';
import { createEntityPermission } from './utils/permissions/permissionTestUtils';

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

    it('Return 200 and organization avatar as absolute URL.', async () => {
      const org = await createTestOrganizationDirect({
        name: `org_with_avatar_${randomSuffix()}`,
        displayName: 'Org With Avatar',
        avatar: 'static/avatars/orgs/test-avatar.webp',
      });
      const { user: owner } = await createAndLoginUser('USER');
      await createMembership(owner.id, org.id, 'OWNER');

      await createPricingForOrganization({
        organizationId: org.id,
        isPrivate: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.pricings.length).toBeGreaterThanOrEqual(1);
      const pricing = response.body.pricings.find((p: any) => p.organization?.id === org.id);
      expect(pricing).toBeDefined();
      expect(pricing.organization.avatar).toBeDefined();
      expect(pricing.organization.avatar).toMatch(/^https?:\/\//);
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

      await createEntityScopedPermission(member.id, organizationId, pricing.serviceName, 'pricing', {
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

      const privatePricing = await createPricingForOrganization({
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
      expect(response.body.pricings.some((p: any) => p.id === privatePricing.id)).toBe(true);
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

    it('Return 200 and list of private pricings when only having access to the collection.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      const pricingsInCollection = [];

      for (let i = 0; i < 3; i++) {
        const pricingInCollection = await createPricingForOrganization({
          organizationId,
          isPrivate: true,
        });

        pricingsInCollection.push(pricingInCollection.serviceName);
      }

      const collection = await createTestCollectionWithPricings(
        { _organizationId: organizationId },
        pricingsInCollection
      );

      await createEntityScopedPermission(member.id, organizationId, collection.slug, 'collection', {
        GET: true,
        PUT: false,
        DELETE: false,
        CREATE: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(3);
    });

    it('Return 200 and a single private pricing due to not having access to whole collection.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      const privatePricingWithAccess = await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      const privatePricingWithoutAccess = await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      const publicPricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createTestCollectionWithPricings(
        { _organizationId: organizationId },
        [privatePricingWithAccess, privatePricingWithoutAccess, publicPricing].map(
          p => p.serviceName
        )
      );

      await createEntityScopedPermission(
        member.id,
        organizationId,
        privatePricingWithAccess.serviceName,
        'pricing',
        {
          GET: true,
          PUT: false,
          DELETE: false,
          CREATE: false,
        }
      );

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${member.token}`);

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
        .get(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(2);
    });

    it('Return 200 and filter pricings by collection with spaces in name', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      const pricingInCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createTestCollectionWithPricings(
        { _organizationId: organizationId, name: 'IEEE TSC 2025' },
        [pricingInCollection.serviceName]
      );

      const response = await request(app)
        .get(
          `${BASE_PATH}/pricings/${organizationId}`
        )
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(1);
      expect(response.body.pricings[0].name).toBe(pricingInCollection.serviceName);
    });
    
    it('Return 200 and list of pricings (including private) in public collection the user has access to', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      const publicPricingInCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const privatePricingInCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      await createTestCollectionWithPricings(
        { _organizationId: organizationId, name: 'IEEE TSC 2025' },
        [publicPricingInCollection.serviceName, privatePricingInCollection.serviceName]
      );

      await createEntityPermission(
        member.id,
        organizationId,
        'pricing',
        privatePricingInCollection.serviceName,
        {
          GET: true,
          CREATE: false,
          PUT: false,
          DELETE: false,
        }
      );

      const response = await request(app)
        .get(
          `${BASE_PATH}/pricings/${organizationId}`
        )
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(2);
      response.body.pricings.forEach((pricing: any) => {
        expect([
          publicPricingInCollection.serviceName,
          privatePricingInCollection.serviceName,
        ]).toContain(pricing.name);
      });
    });

    it('Return 200 and organization avatar as absolute URL.', async () => {
      const org = await createTestOrganizationDirect({
        name: `org_with_avatar_${randomSuffix()}`,
        displayName: 'Org With Avatar',
        avatar: 'static/avatars/orgs/test-avatar.webp',
      });
      const { user: owner } = await createAndLoginUser('USER');
      await createMembership(owner.id, org.id, 'OWNER');

      await createPricingForOrganization({
        organizationId: org.id,
        isPrivate: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${org.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.pricings.length).toBeGreaterThanOrEqual(1);
      const pricing = response.body.pricings.find((p: any) => p.organization?.id === org.id);
      expect(pricing).toBeDefined();
      expect(pricing.organization.avatar).toBeDefined();
      expect(pricing.organization.avatar).toMatch(/^https?:\/\//);
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

    it('Return 403 when MEMBER with org CREATE permission but without entity CREATE permission tries to add version to existing pricing.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      // Grant org-level CREATE permission
      await createOrgScopedPermission(member.id, organizationId, 'pricing', {
        GET: false,
        PUT: false,
        DELETE: false,
        CREATE: true,
      });

      // Owner creates the pricing first
      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      // Member tries to add a new version — should be denied at entity level
      const fixture = await createValidPricingYaml(serviceName);

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

    it('Return 200 when MEMBER with both org CREATE and entity CREATE permission adds version to existing pricing.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      // Grant org-level CREATE permission
      await createOrgScopedPermission(member.id, organizationId, 'pricing', {
        GET: false,
        PUT: false,
        DELETE: false,
        CREATE: true,
      });

      // Owner creates the pricing first
      const { serviceName, id: pricingId } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      // Grant entity-level CREATE permission on the specific pricing
      await createEntityScopedPermission(member.id, organizationId, serviceName, 'pricing', {
        GET: true,
        PUT: false,
        DELETE: false,
        CREATE: true,
      });

      // Member adds a new version
      const fixture = await createValidPricingYaml(serviceName);

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

    it('Return 200 when OWNER adds version to existing pricing (bypasses entity-level check).', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      // Owner creates the pricing first
      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      // Owner adds a new version
      const fixture = await createValidPricingYaml(serviceName);

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

    it('Return 200 and pricing name uses custom name when provided.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const customName = `Rewritten Pricing ${randomSuffix()}`;

      const fixture = await createValidPricingYaml(`original_saas_${randomSuffix()}`);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('private', 'false')
        .field('name', customName)
        .field('saasName', fixture.saasName)
        .field('version', fixture.version)
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(customName);

      const yamlUrl = response.body.yaml;
      const relativePath = yamlUrl.replace(/^https?:\/\/[^/]+\//, '');
      const staticFolder = (process.env.SERVER_STATICS_FOLDER || 'public/').replace(/\/$/, '/');
      const localPath = path.resolve(process.cwd(), staticFolder + relativePath);
      const yamlContent = await fs.readFile(localPath, 'utf8');
      const parsed = yaml.load(yamlContent) as Record<string, any>;
      expect(parsed.saasName).toBe(customName);
    });

    it('Return 200 and YAML saasName is rewritten on disk when adding version with different saasName via named endpoint.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const differentName = `different_name_${randomSuffix()}`;
      const fixture = await createValidPricingYaml(differentName);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${fixture.version}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(serviceName);

      const yamlUrl = response.body.yaml;
      const relativePath = yamlUrl.replace(/^https?:\/\/[^/]+\//, '');
      const staticFolder = (process.env.SERVER_STATICS_FOLDER || 'public/').replace(/\/$/, '/');
      const localPath = path.resolve(process.cwd(), staticFolder + relativePath);
      const yamlContent = await fs.readFile(localPath, 'utf8');
      const parsed = yaml.load(yamlContent) as Record<string, any>;
      expect(parsed.saasName).toBe(serviceName);
    });

    it('Return 200 and YAML saasName is rewritten on disk when adding version with different saasName via named endpoint.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const differentName = `different_name_${randomSuffix()}`;
      const fixture = await createValidPricingYaml(differentName);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${fixture.version}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(serviceName);

      const yamlUrl = response.body.yaml;
      const relativePath = yamlUrl.replace(/^https?:\/\/[^/]+\//, '');
      const staticFolder = (process.env.SERVER_STATICS_FOLDER || 'public/').replace(/\/$/, '/');
      const localPath = path.resolve(process.cwd(), staticFolder + relativePath);
      const yamlContent = await fs.readFile(localPath, 'utf8');
      const parsed = yaml.load(yamlContent) as Record<string, any>;
      expect(parsed.saasName).toBe(serviceName);
    });

    it('Return 200 and YAML on disk has saasName rewritten to match existing pricing when adding version with different saasName via named endpoint.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const differentName = `different_name_${randomSuffix()}`;
      const fixture = await createValidPricingYaml(differentName);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${fixture.version}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(serviceName);

      const yamlUrl = response.body.yaml;
      expect(yamlUrl).toBeDefined();

      const relativePath = yamlUrl.replace(/^https?:\/\/[^/]+\//, '');
      const staticFolder = (process.env.SERVER_STATICS_FOLDER || 'public/').replace(/\/$/, '/');
      const localPath = path.resolve(process.cwd(), staticFolder + relativePath);
      const yamlContent = await fs.readFile(localPath, 'utf8');
      const parsed = yaml.load(yamlContent) as Record<string, any>;
      expect(parsed.saasName).toBe(serviceName);
    });
  });

  describe('POST /api/v1/pricings/:organizationId/:pricingName/:pricingVersion', () => {
    it('Return 200 when OWNER adds version with matching name.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const fixture = await createValidPricingYaml(serviceName);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${fixture.version}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(serviceName);
    });

    it('Return 200 when OWNER adds version with different YAML name (name is overridden).', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const fixture = await createValidPricingYaml(`different_name_${randomSuffix()}`);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${fixture.version}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(serviceName);
    });

    it('Return 200 when MEMBER with org CREATE and entity CREATE adds version.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      await createOrgScopedPermission(member.id, organizationId, 'pricing', {
        GET: false,
        PUT: false,
        DELETE: false,
        CREATE: true,
      });

      const { serviceName, id: pricingId } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createEntityScopedPermission(member.id, organizationId, serviceName, 'pricing', {
        GET: true,
        PUT: false,
        DELETE: false,
        CREATE: true,
      });

      const fixture = await createValidPricingYaml(serviceName);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${fixture.version}`)
        .set('Authorization', `Bearer ${member.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(serviceName);
    });

    it('Return 403 when MEMBER with org CREATE but without entity CREATE tries to add version.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      await createOrgScopedPermission(member.id, organizationId, 'pricing', {
        GET: false,
        PUT: false,
        DELETE: false,
        CREATE: true,
      });

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const fixture = await createValidPricingYaml(serviceName);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${fixture.version}`)
        .set('Authorization', `Bearer ${member.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('Return 403 when MEMBER without org CREATE tries to add version.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const fixture = await createValidPricingYaml(serviceName);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${fixture.version}`)
        .set('Authorization', `Bearer ${member.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('Return 403 when user not in org tries to add version.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const fixture = await createValidPricingYaml(serviceName);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${fixture.version}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('Return 401 when no auth header is provided.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const fixture = await createValidPricingYaml(serviceName);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${fixture.version}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });

    it('Return 200 when MEMBER with entity CREATE but WITHOUT org CREATE adds version via named endpoint.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      // NO org-level CREATE permission granted

      // Owner creates the pricing first
      const { serviceName, id: pricingId } = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      // Grant ONLY entity-level CREATE permission on the specific pricing
      await createEntityScopedPermission(member.id, organizationId, serviceName, 'pricing', {
        GET: true,
        PUT: false,
        DELETE: false,
        CREATE: true,
      });

      // Member adds a new version via the named endpoint
      const fixture = await createValidPricingYaml(serviceName);

      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/${fixture.version}`)
        .set('Authorization', `Bearer ${member.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe(serviceName);
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

    it('Return 200 and organization avatar as absolute URL in versions.', async () => {
      const org = await createTestOrganizationDirect({
        name: `org_with_avatar_${randomSuffix()}`,
        displayName: 'Org With Avatar',
        avatar: 'static/avatars/orgs/test-avatar.webp',
      });
      const { user: owner } = await createAndLoginUser('USER');
      await createMembership(owner.id, org.id, 'OWNER');

      const { serviceName } = await createPricingForOrganization({
        organizationId: org.id,
        isPrivate: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${org.id}/${serviceName}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.versions).toBeDefined();
      expect(response.body.versions.length).toBeGreaterThanOrEqual(1);
      const version = response.body.versions[0];
      expect(version.organization).toBeDefined();
      expect(version.organization.avatar).toBeDefined();
      expect(version.organization.avatar).toMatch(/^https?:\/\//);
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

  describe('GET /api/v1/users/me/pricings', () => {
    it('Return 401 with missing Authorization header.', async () => {
      const response = await request(app).get(`${BASE_PATH}/users/me/pricings`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });

    it('Return 200 with empty list when user has no pricings.', async () => {
      const { user } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/pricings`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(0);
      expect(response.body.total).toBe(0);
    });

    it('Return 200 and paginated pricing list from user organizations.', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      for (let i = 0; i < 5; i++) {
        await createPricingForOrganization({
          organizationId,
          isPrivate: false,
        });
      }

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/pricings?limit=3&offset=0`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(typeof response.body.total).toBe('number');
      expect(response.body.pricings.length).toBe(3);
    });

    it('Return 200 and pricings from multiple organizations the user belongs to.', async () => {
      const { user, organizationId: org1 } = await createAndLoginUser('USER');
      const { organizationId: org2 } = await createTestUser('USER');

      await createMembership(user.id, org2, 'MEMBER');

      await createPricingForOrganization({ organizationId: org1, isPrivate: false });
      await createPricingForOrganization({ organizationId: org2, isPrivate: false });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/pricings`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.pricings.length).toBeGreaterThanOrEqual(2);
      const orgIds = response.body.pricings.map((p: any) => p.organization?.id);
      expect(orgIds).toContain(org1);
      expect(orgIds).toContain(org2);
    });

    it('Return 200 and only PUBLIC pricings for regular USER in another organization.', async () => {
      const { organizationId: otherOrg } = await createTestUser('USER');
      const { user } = await createAndLoginUser('USER');

      await createMembership(user.id, otherOrg, 'MEMBER');

      await createPricingForOrganization({ organizationId: otherOrg, isPrivate: false });
      await createPricingForOrganization({ organizationId: otherOrg, isPrivate: true });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/pricings`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(1);
      expect(response.body.pricings[0].private).toBe(false);
    });

    it('Return 200 and all pricings (public + private) when user is OWNER of the org.', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      await createPricingForOrganization({ organizationId, isPrivate: false });
      await createPricingForOrganization({ organizationId, isPrivate: true });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/pricings`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.pricings.length).toBe(2);
    });

    it('Return 200 and all pricings for ADMIN user across any organization.', async () => {
      const { organizationId } = await createTestUser('USER');

      await createPricingForOrganization({ organizationId, isPrivate: false });
      await createPricingForOrganization({ organizationId, isPrivate: true });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/pricings`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.pricings.length).toBeGreaterThanOrEqual(2);
      const pricingNames = response.body.pricings.map((p: any) => p.name);
      expect(pricingNames).toContain(
        response.body.pricings.find((p: any) => p.private === false)?.name
      );
      expect(pricingNames).toContain(
        response.body.pricings.find((p: any) => p.private === true)?.name
      );
    });

    it('Return 200 and private pricing visible via entity-scoped GET permission.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      const privatePricing = await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      await createEntityScopedPermission(member.id, organizationId, privatePricing.serviceName, 'pricing', {
        GET: true,
        PUT: false,
        DELETE: false,
        CREATE: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/pricings`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(response.body.pricings.length).toBe(1);
      expect(response.body.pricings[0].id).toBe(privatePricing.id);
    });

    it('Return 200 and filtered pricing list when name query parameter is provided.', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      const testPricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createPricingForOrganization({ organizationId, isPrivate: false });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/pricings?name=${testPricing.serviceName}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(1);
      expect(response.body.pricings[0].name).toBe(testPricing.serviceName);
    });

    it('Return 200 with correct pricing response structure.', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      await createPricingForOrganization({ organizationId, isPrivate: false });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/pricings?limit=1&offset=0`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(typeof response.body.total).toBe('number');
      expect(response.body.pricings.length).toBe(1);

      const pricing = response.body.pricings[0];
      expect(pricing.id).toBeDefined();
      expect(pricing.name).toBeDefined();
      expect(pricing.version).toBeDefined();
      expect(pricing.organization).toBeDefined();
      expect(pricing.organization.id).toBeDefined();
      expect(typeof pricing.private).toBe('boolean');
    });

    it('Return 200 with pricings in collection when collection filter is used.', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      const pricingInCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createPricingForOrganization({ organizationId, isPrivate: false });

      const collection = await createTestCollectionWithPricings(
        { _organizationId: organizationId },
        [pricingInCollection.serviceName]
      );

      const response = await request(app)
        .get(
          `${BASE_PATH}/users/me/pricings?collection=${encodeURIComponent(collection.slug || '')}`
        )
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.pricings)).toBe(true);
      expect(response.body.pricings.length).toBe(1);
      expect(response.body.pricings[0].name).toBe(pricingInCollection.serviceName);
    });

    it('Return 200 with pricings from org where user is MEMBER with scoped permissions only.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      const accessiblePricing = await createPricingForOrganization({
        organizationId,
        isPrivate: true,
      });

      await createPricingForOrganization({ organizationId, isPrivate: true });

      await createEntityScopedPermission(
        member.id,
        organizationId,
        accessiblePricing.serviceName,
        'pricing',
        {
          GET: true,
          PUT: false,
          DELETE: false,
          CREATE: false,
        }
      );

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/pricings`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(response.body.pricings.length).toBe(1);
      expect(response.body.pricings[0].id).toBe(accessiblePricing.id);
    });
  });

  describe('MEMBER visibility of pricings without collection', () => {
    it('Return 200 and public pricings without collection for MEMBER via /users/me/pricings.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      const publicPricingNoCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/pricings`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      const pricingNames = response.body.pricings.map((p: any) => p.name);
      expect(pricingNames).toContain(publicPricingNoCollection.serviceName);
    });

    it('Return 200 and public pricings without collection via org endpoint for MEMBER.', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      const publicPricingNoCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      const pricingNames = response.body.pricings.map((p: any) => p.name);
      expect(pricingNames).toContain(publicPricingNoCollection.serviceName);
    });
  });

  describe('GET /api/v1/pricings with excludePricingsInCollection filter', () => {
    it('Return 200 and only pricings without collection when excludePricingsInCollection=true.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const pricingWithoutCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const pricingInCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createTestCollectionWithPricings(
        { _organizationId: organizationId },
        [pricingInCollection.serviceName]
      );

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}?excludePricingsInCollection=true`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.pricings.length).toBeGreaterThanOrEqual(1);
      const pricingNames = response.body.pricings.map((p: any) => p.name);
      expect(pricingNames).toContain(pricingWithoutCollection.serviceName);
      expect(pricingNames).not.toContain(pricingInCollection.serviceName);
    });

    it('Return 200 and empty list when all pricings are in collections and excludePricingsInCollection=true.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const pricingInCollection = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createTestCollectionWithPricings(
        { _organizationId: organizationId },
        [pricingInCollection.serviceName]
      );

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}?excludePricingsInCollection=true`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.pricings.length).toBe(0);
    });

    it('Return 400 when excludePricingsInCollection and collection are used together.', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}?excludePricingsInCollection=true&collection=some-slug`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(422);
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

  describe('Pricing version name consistency', () => {
    it('should preserve the original pricing name when adding a new version', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const serviceName = `TestPricing_${randomSuffix()}`;

      // Create first version with a specific name
      const v1 = await createPricingForOrganization({
        organizationId,
        serviceName,
        version: '1.0.0',
        isPrivate: false,
      });

      expect(v1.serviceName).toBe(serviceName);

      // Create a second version using the slug
      const fixture = await createValidPricingYaml(serviceName, '2.0.0');
      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/2.0.0`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      expect(response.status).toBe(200);

      // Verify both versions exist with the SAME name in the database
      const allVersions = await PricingMongoose.find({
        name: serviceName,
        _organizationId: organizationId,
      }).sort({ version: 1 });

      expect(allVersions.length).toBe(2);
      expect(allVersions[0].name).toBe(serviceName);
      expect(allVersions[0].version).toBe('1.0.0');
      expect(allVersions[1].name).toBe(serviceName);
      expect(allVersions[1].version).toBe('2.0.0');

      // Verify slugs are the same for both versions
      expect(allVersions[0].slug).toBeDefined();
      expect(allVersions[1].slug).toBeDefined();
      expect(allVersions[0].slug).toBe(allVersions[1].slug);
    });

    it('should not use the slug as the pricing name', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const serviceName = `MyPricing_${randomSuffix()}`;

      const v1 = await createPricingForOrganization({
        organizationId,
        serviceName,
        version: '1.0.0',
        isPrivate: false,
      });

      // The slug should be lowercase version of the name
      const pricingDoc = await PricingMongoose.findOne({
        name: serviceName,
        _organizationId: organizationId,
      });
      expect(pricingDoc).toBeDefined();
      expect(pricingDoc!.name).toBe(serviceName);
      expect(pricingDoc!.slug).toBeDefined();
      expect(pricingDoc!.slug).not.toBe(serviceName); // slug is lowercase, name preserves case

      // Add another version
      const fixture = await createValidPricingYaml(serviceName, '2.0.0');
      await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}/${serviceName}/2.0.0`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .field('private', 'false')
        .attach('yaml', fixture.filePath);

      // Verify the second version also has the original name, not the slug
      const v2Doc = await PricingMongoose.findOne({
        name: serviceName,
        version: '2.0.0',
        _organizationId: organizationId,
      });
      expect(v2Doc).toBeDefined();
      expect(v2Doc!.name).toBe(serviceName);
      expect(v2Doc!.name).not.toBe(pricingDoc!.slug);
    });
  });

  describe('Auto-grant permissions on pricing creation for MEMBER', () => {
    it('Return 200 and auto-grant full permissions when MEMBER creates a new pricing.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

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

      const permission = await EntityPermissionMongoose.findOne({
        _userId: member.id,
        _organizationId: organizationId,
        entityType: 'pricing',
        entitySlug: fixture.saasName.toLowerCase().replace(/\s+/g, '-'),
      });

      expect(permission).toBeDefined();
      expect(permission!.permissions.GET).toBe(true);
      expect(permission!.permissions.PUT).toBe(true);
      expect(permission!.permissions.DELETE).toBe(true);
      expect(permission!.permissions.CREATE).toBe(true);
    });

    it('Return 200 and NOT auto-grant permissions when OWNER creates a pricing.', async () => {
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

      const permission = await EntityPermissionMongoose.findOne({
        _userId: owner.id,
        _organizationId: organizationId,
        entityType: 'pricing',
        entitySlug: fixture.saasName.toLowerCase().replace(/\s+/g, '-'),
      });

      expect(permission).toBeNull();
    });

    it('Return 200 and NOT auto-grant full permissions when MEMBER adds a version to an existing pricing.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      // Grant org-level CREATE so member can create new pricings
      await createOrgScopedPermission(member.id, organizationId, 'pricing', {
        GET: false,
        PUT: false,
        DELETE: false,
        CREATE: true,
      });

      // Member creates a new pricing first (should get auto-granted permissions)
      const fixture1 = await createValidPricingYaml(`pricing_${randomSuffix()}`);
      await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .field('private', 'false')
        .field('saasName', fixture1.saasName)
        .field('version', fixture1.version)
        .attach('yaml', fixture1.filePath);

      // Grant entity-level CREATE so member can add versions
      await createEntityScopedPermission(member.id, organizationId, fixture1.saasName, 'pricing', {
        GET: true,
        PUT: false,
        DELETE: false,
        CREATE: true,
      });

      // Member adds a second version to the same pricing
      const fixture2 = await createValidPricingYaml(fixture1.saasName);
      const response = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .field('private', 'false')
        .field('saasName', fixture2.saasName)
        .field('version', fixture2.version)
        .attach('yaml', fixture2.filePath);

      expect(response.status).toBe(200);

      // Verify permissions are NOT auto-granted when adding a version
      const permission = await EntityPermissionMongoose.findOne({
        _userId: member.id,
        _organizationId: organizationId,
        entityType: 'pricing',
        entitySlug: fixture1.saasName.toLowerCase().replace(/\s+/g, '-'),
      });

      expect(permission).toBeDefined();
      expect(permission!.permissions.GET).toBe(true);
      expect(permission!.permissions.PUT).toBe(false);
      expect(permission!.permissions.DELETE).toBe(false);
      expect(permission!.permissions.CREATE).toBe(true);
    });

    it('Return 200 and MEMBER can access private pricing with auto-granted permissions.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      await createOrgScopedPermission(member.id, organizationId, 'pricing', {
        GET: false,
        PUT: false,
        DELETE: false,
        CREATE: true,
      });

      // Member creates a private pricing
      const fixture = await createValidPricingYaml(`pricing_${randomSuffix()}`);
      const postResponse = await request(app)
        .post(`${BASE_PATH}/pricings/${organizationId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .field('private', 'true')
        .field('saasName', fixture.saasName)
        .field('version', fixture.version)
        .attach('yaml', fixture.filePath);

      expect(postResponse.status).toBe(200);

      // Member can GET the private pricing they created
      const getResponse = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${fixture.saasName}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.name).toBe(fixture.saasName);

      // Member can UPDATE the pricing they created
      const putResponse = await request(app)
        .put(`${BASE_PATH}/pricings/${organizationId}/${fixture.saasName}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ url: 'https://example.com/updated' });

      expect(putResponse.status).toBe(200);

      // Member can DELETE the pricing they created
      const deleteResponse = await request(app)
        .delete(`${BASE_PATH}/pricings/${organizationId}/${fixture.saasName}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.message).toBeDefined();
    });
  });
});
