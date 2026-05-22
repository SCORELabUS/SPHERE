import dotenv from 'dotenv';
import request from 'supertest';
import fs from 'fs/promises';
import unzipper from 'unzipper';
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import { createAndLoginUser, createTestUser, deleteTestUser } from './utils/users/userTestUtils';
import { createCollectionForOrganization, createTestCollection, createTestCollectionWithPricings } from './utils/collections/collectionTestUtils';
import { createBulkZipFixture, removeTempPaths } from './utils/pricingFixtures';
import { createPricingForOrganization } from './utils/pricings/pricingTestUtils';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { randomSuffix } from './utils/helpers';
import { LeanUser } from '../main/types/models/User';
import { createMembership } from './utils/organizations';
import { createEntityScopedPermission } from './utils/organizations/organizationTestUtils';

dotenv.config();

describe('Pricing Collections API integration', () => {
  let app: TestApp;
  const adminUser: LeanUser = testContainer.resolve('adminUser');
  const testUser: LeanUser = testContainer.resolve('testUser');
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
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

  describe('GET /api/v1/collections', () => {
    it('returns 200 and paginated collections list with limit and offset', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      for (let i = 0; i < 5; i++) {
        await createTestCollection({ _organizationId: organizationId });
      }
      
      const response = await request(app)
        .get(`${BASE_PATH}/collections?limit=2&offset=0`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body.collections)).toBe(true);
      expect(response.body.collections.length).toBe(2);
      expect(response.body.total).toBe(5);
    });

    it('returns empty collections when offset exceeds total', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      for (let i = 0; i < 3; i++) {
        await createTestCollection({ _organizationId: organizationId });
      }

      const response = await request(app)
        .get(`${BASE_PATH}/collections?limit=10&offset=10`);

      expect(response.status).toBe(200);
      expect(response.body.collections.length).toBe(0);
      expect(response.body.total).toBe(3);
    });

    it('returns all collections when limit exceeds total', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      for (let i = 0; i < 3; i++) {
        await createTestCollection({ _organizationId: organizationId });
      }

      const response = await request(app)
        .get(`${BASE_PATH}/collections?limit=100&offset=0`);

      expect(response.status).toBe(200);
      expect(response.body.collections.length).toBe(3);
      expect(response.body.total).toBe(3);
    });

    it('returns correct page when using offset for second page', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const names: string[] = [];
      for (let i = 0; i < 5; i++) {
        const c = await createTestCollection({ _organizationId: organizationId, name: `Collection_${i}` });
        names.push(c.name);
      }

      const page1 = await request(app)
        .get(`${BASE_PATH}/collections?limit=2&offset=0`);
      const page2 = await request(app)
        .get(`${BASE_PATH}/collections?limit=2&offset=2`);

      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);
      expect(page1.body.collections.length).toBe(2);
      expect(page2.body.collections.length).toBe(2);
      expect(page1.body.total).toBe(5);
      expect(page2.body.total).toBe(5);

      const page1Names = page1.body.collections.map((c: any) => c.name);
      const page2Names = page2.body.collections.map((c: any) => c.name);
      expect(page1Names).not.toEqual(expect.arrayContaining(page2Names));
    });

    it('returns 200 and filters collections by name', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      await createTestCollection({ _organizationId: organizationId, name: 'Alpha Collection' });
      const matchingCollection = await createTestCollection({ _organizationId: organizationId, name: 'Beta Collection' });
      await createTestCollection({ _organizationId: organizationId, name: 'Gamma Collection' });

      const response = await request(app)
        .get(`${BASE_PATH}/collections?name=beta`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
      expect(response.body.total).toBe(1);
      expect(response.body.collections.length).toBe(1);
      expect(response.body.collections[0].name).toBe(matchingCollection.name);
    });

    it('returns 200 and filters collections by organizations list', async () => {
      const {organizationId: organizationIdA} = await createTestUser('USER');
      const {organizationId: organizationIdB} = await createTestUser('USER');
      const {organizationId: organizationIdC} = await createTestUser('USER');

      await createTestCollection({ _organizationId: organizationIdA, name: 'Collection A' });
      await createTestCollection({ _organizationId: organizationIdB, name: 'Collection B' });
      await createTestCollection({ _organizationId: organizationIdC, name: 'Collection C' });

      const response = await request(app)
        .get(
          `${BASE_PATH}/collections?organizationIds=${organizationIdA},${organizationIdB}`
        );

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
      expect(response.body.total).toBe(2);
      const names = response.body.collections.map((collection: any) => collection.organization.id);
      expect(names).toEqual(expect.arrayContaining([organizationIdA, organizationIdB]));
      expect(names).not.toContain(organizationIdC);
    });

    it('returns 200 and sorts collections by numberOfPricings', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const requester = await createAndLoginUser('USER');

      const zeroPricingsCollection = await createTestCollection({ _organizationId: organizationId, name: 'Zero Pricings' });

      const onePricing = await createPricingForOrganization({ organizationId });
      const onePricingCollection = await createTestCollectionWithPricings(
        { _organizationId: organizationId, name: 'One Pricing' },
        [onePricing.serviceName]
      );

      const twoPricingA = await createPricingForOrganization({ organizationId });
      const twoPricingB = await createPricingForOrganization({ organizationId });
      const twoPricingsCollection = await createTestCollectionWithPricings(
        { _organizationId: organizationId, name: 'Two Pricings' },
        [twoPricingA.serviceName, twoPricingB.serviceName]
      );

      const response = await request(app)
        .get(`${BASE_PATH}/collections?sortBy=numberOfPricings&sort=desc`)
        .set('Authorization', `Bearer ${requester.user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(3);
      expect(response.body.collections.map((collection: any) => collection.name)).toEqual([
        twoPricingsCollection.name,
        onePricingCollection.name,
        zeroPricingsCollection.name,
      ]);
    });
  });

  describe('GET /api/v1/collections/:organizationId', () => {
    it('returns 200 and user collections when owner requests own collections', async () => {
      const { user: owner, organizationId} = await createAndLoginUser('USER');

      await createTestCollection({ _organizationId: organizationId });

      const response = await request(app)
        .get(`${BASE_PATH}/collections/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
    });

    it('returns 200 and public collections for other users', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      // create one public and one private collection
      const publicCollection = await createTestCollection({ _organizationId: organizationId });
      const privateCollection = await createTestCollection({ _organizationId: organizationId, private: true });

      const response = await request(app)
        .get(`${BASE_PATH}/collections/${organizationId}`)
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
      // requester should only see public collections
      const names = response.body.collections.map((c: any) => c.name);
      expect(names).toContain(publicCollection.name);
      expect(names).not.toContain(privateCollection.name);
    });

    it('returns 200 and all collections when ADMIN requests another organization', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const publicCollection = await createTestCollection({ _organizationId: organizationId });
      const privateCollection = await createTestCollection({ _organizationId: organizationId, private: true });

      const response = await request(app)
        .get(`${BASE_PATH}/collections/${organizationId}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
      const names = response.body.collections.map((c: any) => c.name);
      expect(names).toContain(publicCollection.name);
      expect(names).toContain(privateCollection.name);
    });

    it('returns 200, public collections and correct total number of pricings for other users', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const testPricing1 = await createPricingForOrganization({ organizationId });
      const testPricing2 = await createPricingForOrganization({ organizationId });

      // create one public and one private collection
      const publicCollection = await createTestCollectionWithPricings({ _organizationId: organizationId }, [testPricing1.serviceName, testPricing2.serviceName]);
      const privateCollection = await createTestCollection({ _organizationId: organizationId, private: true });

      const response = await request(app)
        .get(`${BASE_PATH}/collections/${organizationId}`)
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
      // requester should only see public collections
      expect(response.body.collections.length).toBe(1);
      const names = response.body.collections.map((c: any) => c.name);
      expect(names).toContain(publicCollection.name);
      expect(names).not.toContain(privateCollection.name);
      // the public collection should have the correct number of pricings
      expect(response.body.collections[0].numberOfPricings).toBeGreaterThan(1);
    });
  });

  describe('GET /api/v1/users/me/collections', () => {
    it('returns 401 with missing Authorization header', async () => {
      const response = await request(app).get(`${BASE_PATH}/users/me/collections`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });

    it('returns 200 with empty list when user has no collections', async () => {
      const { user } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/collections`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
      expect(response.body.collections.length).toBe(0);
      expect(response.body.total).toBe(0);
    });

    it('returns 200 and paginated collections list from user organizations', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      for (let i = 0; i < 5; i++) {
        await createTestCollection({ _organizationId: organizationId });
      }

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/collections?limit=3&offset=0`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
      expect(typeof response.body.total).toBe('number');
      expect(response.body.collections.length).toBe(3);
    });

    it('returns 200 and collections from multiple organizations the user belongs to', async () => {
      const { user, organizationId: org1 } = await createAndLoginUser('USER');
      const { organizationId: org2 } = await createTestUser('USER');

      await createMembership(user.id, org2, 'MEMBER');

      await createTestCollection({ _organizationId: org1, name: `Org1_${randomSuffix()}` });
      await createTestCollection({ _organizationId: org2, name: `Org2_${randomSuffix()}` });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/collections`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
      expect(response.body.collections.length).toBeGreaterThanOrEqual(2);
      const orgIds = response.body.collections.map((c: any) => c.organization?.id);
      expect(orgIds).toContain(org1);
      expect(orgIds).toContain(org2);
    });

    it('returns 200 and only PUBLIC collections for regular USER in another organization', async () => {
      const { organizationId: otherOrg } = await createTestUser('USER');
      const { user } = await createAndLoginUser('USER');

      await createMembership(user.id, otherOrg, 'MEMBER');

      const publicCollection = await createTestCollection({ _organizationId: otherOrg, private: false });
      await createTestCollection({ _organizationId: otherOrg, private: true });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/collections`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
      expect(response.body.collections.length).toBe(1);
      expect(response.body.collections[0].name).toBe(publicCollection.name);
    });

    it('returns 200 and all collections (public + private) when user is OWNER of the organization', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      await createTestCollection({ _organizationId: organizationId, private: false });
      await createTestCollection({ _organizationId: organizationId, private: true });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/collections`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.collections.length).toBe(2);
    });

    it('returns 200 and all collections for ADMIN user across any organization', async () => {
      const { organizationId } = await createTestUser('USER');

      const publicCollection = await createTestCollection({ _organizationId: organizationId, private: false });
      const privateCollection = await createTestCollection({ _organizationId: organizationId, private: true });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/collections`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
      expect(response.body.collections.length).toBeGreaterThanOrEqual(2);
      const names = response.body.collections.map((c: any) => c.name);
      expect(names).toContain(publicCollection.name);
      expect(names).toContain(privateCollection.name);
    });

    it('returns 200 and private collection visible via entity-scoped GET permission', async () => {
      const { organizationId } = await createTestUser('USER');
      const { user: member } = await createAndLoginUser('USER');

      await createMembership(member.id, organizationId, 'MEMBER');

      const privateCollection = await createTestCollection({
        _organizationId: organizationId,
        private: true,
      });

      await createEntityScopedPermission(member.id, organizationId, privateCollection.id, 'collection', {
        GET: true,
        PUT: false,
        DELETE: false,
        CREATE: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/collections`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(response.body.collections.length).toBe(1);
      expect(response.body.collections[0].id).toBe(privateCollection.id);
    });

    it('returns 200 and filtered collection list when name query parameter is provided', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      const targetCollection = await createTestCollection({
        _organizationId: organizationId,
        name: `MyTarget_${randomSuffix()}`,
      });

      await createTestCollection({
        _organizationId: organizationId,
        name: `Other_${randomSuffix()}`,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/collections?name=${encodeURIComponent(targetCollection.name)}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.collections)).toBe(true);
      expect(response.body.collections.length).toBe(1);
      expect(response.body.collections[0].name).toBe(targetCollection.name);
    });

    it('returns 200 with correct collection response structure', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      await createTestCollection({ _organizationId: organizationId, private: false });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/collections?limit=1&offset=0`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(typeof response.body.total).toBe('number');
      expect(response.body.collections.length).toBe(1);

      const collection = response.body.collections[0];
      expect(collection.id).toBeDefined();
      expect(collection.name).toBeDefined();
      expect(collection.organization).toBeDefined();
      expect(collection.organization.id).toBeDefined();
      expect(typeof collection.numberOfPricings).toBe('number');
    });
  });

  describe('POST /api/v1/collections/:organizationId', () => {
    it('Return 201 when user with requested organizationId tries to create a collection', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const payload = {
        name: `Collection_${randomSuffix()}`,
        description: 'A test collection',
        private: false,
      };

      const res = await request(app)
        .post(`${BASE_PATH}/collections/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send(payload);

      expect(res.status).toBe(201);
      if (res.body._id) collectionIdsToDelete.add(res.body._id);
    });

    it('Return 201 when providing pricings list', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const p1 = await createPricingForOrganization({ organizationId });
      const p2 = await createPricingForOrganization({ organizationId });

      const payload = {
        name: `CollectionWithPricings_${randomSuffix()}`,
        description: 'Collection that references existing pricings',
        private: false,
        pricings: [p1.serviceName, p2.serviceName],
      };

      const res = await request(app)
        .post(`${BASE_PATH}/collections/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send(payload);

      expect(res.status).toBe(201);
      // response should include the linked pricings
      expect(Array.isArray(res.body.data.pricings)).toBe(true);
      const linkedNames = res.body.data.pricings.map((p: any) => p.name ?? p);
      expect(linkedNames).toEqual(expect.arrayContaining([p1.serviceName, p2.serviceName]));
    });

    it('Return 201 when ADMIN creates a collection for another user', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const payload = {
        name: `Collection_${randomSuffix()}`,
        description: 'A test collection',
        private: false,
      };

      const res = await request(app)
        .post(`${BASE_PATH}/collections/${organizationId}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send(payload);

      expect(res.status).toBe(201);
      if (res.body._id) collectionIdsToDelete.add(res.body._id);
    });

    it('returns 403 when USER tries to create a collection for another user', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { organizationId } = await createAndLoginUser('USER');

      const payload = { name: `Collection_${randomSuffix()}`, private: false };

      const res = await request(app)
        .post(`${BASE_PATH}/collections/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send(payload);

      expect(res.status).toBe(403);
    });

    it('returns 422 when required fields are missing', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const res = await request(app)
        .post(`${BASE_PATH}/collections/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          description: 'no name',
        });
      expect(res.status).toBe(422);
      expect(Array.isArray(res.body.errors)).toBe(true);
    });
  });

  describe('POST /api/v1/collections/:organizationId/bulk', () => {
    it('accepts a zip file and creates a collection from bulk pricings', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { zipPath, tempPaths } = await createBulkZipFixture();
      generatedFilesToDelete.add(zipPath);

      const res = await request(app)
        .post(`${BASE_PATH}/collections/${organizationId}/bulk`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('name', `BulkCollection_${randomSuffix()}`)
        .field('description', 'Collection created from bulk upload')
        .field('private', 'false')
        .attach('zip', zipPath);

      expect(res.status).toBe(201);
      if (res.body._id) collectionIdsToDelete.add(res.body._id);
      await removeTempPaths(tempPaths);
    });
  });

  describe('POST /api/v1/collections/:organizationId/pricings', () => {
    it('Return 200 and success message when adding own pricing to a valid collection.', async () => {
      const { user: owner, organizationId} = await createAndLoginUser('USER');

      const collection = await createCollectionForOrganization(organizationId);

      const { serviceName } = await createPricingForOrganization({
        organizationId,
        serviceName: `pricing_${randomSuffix()}`,
        version: '1.0.0',
      });

      const response = await request(app)
        .post(`${BASE_PATH}/collections/${organizationId}/pricings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ pricingName: serviceName, collectionId: collection.id });

      expect(response.status).toBe(200);
      expect(response.body.message).toBeDefined();
    });

    it('Return 404 and error object when pricing does not exist for authenticated user.', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const collection = await createCollectionForOrganization(organizationId);

      const response = await request(app)
        .post(`${BASE_PATH}/collections/${organizationId}/pricings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ pricingName: `nonexistent_${randomSuffix()}`, collectionId: collection.id });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('Return 401 and error object with missing Authorization header.', async () => {
      const response = await request(app)
        .post(`${BASE_PATH}/collections/${testUser.username}/pricings`)
        .send({ pricingName: 'any-pricing', collectionId: '507f1f77bcf86cd799439011' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/v1/collections/:organizationId/:collectionName', () => {
    it('returns 200 and collection details without authentication', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const collection = await createTestCollection({ _organizationId: organizationId });

      const res = await request(app)
        .get(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(collection.name);
    });
    
    it('returns 200 and collection details for owner', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const collection = await createTestCollection({ _organizationId: organizationId });

      const res = await request(app)
        .get(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(collection.name);
    });
    
    it('returns 200 and collection details with lastUpdate for owner', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const testPricing = await createPricingForOrganization({ organizationId: organizationId });

      const collection = await createTestCollectionWithPricings({ _organizationId: organizationId }, [testPricing.serviceName]);

      const res = await request(app)
        .get(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(collection.name);
      expect(res.body.lastUpdate).toBeDefined();
    });
    
    it('returns 200 and collection with exact name', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const collection1 = await createTestCollection({ _organizationId: organizationId, name: `Test Collection` });
      await createTestCollection({ _organizationId: organizationId, name: `Test Collection 2` });

      const res = await request(app)
        .get(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection1.slug)}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(collection1.name);
    });

    it('returns 404 for non-existing collection', async () => {
      const res = await request(app)
        .get(`${BASE_PATH}/collections/${testUser.username}/nonexistent`)
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/collections/:organizationId/:collectionName', () => {
    it('Return 200 and allows owner to update collection metadata', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const collection = await createTestCollection({ _organizationId: organizationId });

      const res = await request(app)
        .put(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ description: 'Updated description' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(collection.name);
    });
    
    it('Return 200 and allows owner to update collection name', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const collection = await createTestCollection({ _organizationId: organizationId });

      const res = await request(app)
        .put(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Updated Collection Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Collection Name');
    });
    
    it('Return 200 and allows owner to update name of bulk created collection', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const { zipPath, tempPaths } = await createBulkZipFixture();
      generatedFilesToDelete.add(zipPath);

      const resCreate = await request(app)
        .post(`${BASE_PATH}/collections/${organizationId}/bulk`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('name', `BulkCollection_${randomSuffix()}`)
        .field('description', 'Collection created from bulk upload')
        .field('private', 'false')
        .attach('zip', zipPath);

      const res = await request(app)
        .put(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(resCreate.body.collection.slug)}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Updated Collection Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Collection Name');

      if (resCreate.body._id) collectionIdsToDelete.add(resCreate.body._id);
      await removeTempPaths(tempPaths);
    });
    
    it('Return 200 and allows ADMIN to update other user collection metadata', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const collection = await createTestCollection({ _organizationId: organizationId });

      const res = await request(app)
        .put(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ private: true });

      expect(res.status).toBe(200);
      expect(res.body.private).toBe(true);
    });

    it('returns 403 when USER tries to update another user collection', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: requester } = await createAndLoginUser('USER');

      const collection = await createTestCollection({ _organizationId: organizationId });

      const res = await request(app)
        .put(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}`)
        .set('Authorization', `Bearer ${requester.token}`)
        .send({ description: 'malicious update' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/collections/:organizationId/:collectionName', () => {
    it('Return 204 and allows owner to delete own collection', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const collection = await createTestCollection({ _organizationId: organizationId });

      const res = await request(app)
        .delete(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(204);
    });
    
    it('Return 204 and allows ADMIN to delete any collection', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const collection = await createTestCollection({ _organizationId: organizationId });

      const res = await request(app)
        .delete(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(204);
    });
    
    it('Return 204 and also remove all pricings when deleting a collection', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const testPricing1 = await createPricingForOrganization({ organizationId: organizationId });
      const testPricing2 = await createPricingForOrganization({ organizationId: organizationId });

      const collection = await createTestCollectionWithPricings({ _organizationId: organizationId }, [testPricing1.serviceName, testPricing2.serviceName]);

      const res = await request(app)
        .delete(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}?cascade=true`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(204);
      // the pricings that belonged to the collection should also be deleted
      const resGet1 = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${testPricing1.serviceName}`)
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(resGet1.status).toBe(404);
      const resGet2 = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${testPricing2.serviceName}`)
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(resGet2.status).toBe(404);
    });

    it('returns 403 when USER tries to delete another user collection', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: requester } = await createAndLoginUser('USER');

      const collection = await createTestCollection({ _organizationId: organizationId });
      collectionIdsToDelete.add(collection.id);

      const res = await request(app)
        .delete(`${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/collections/:organizationId/:collectionName/pricings/:pricingName', () => {
    it('returns 200 and removes a pricing from the collection for its owner', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const pricingToRemove = await createPricingForOrganization({ organizationId });
      const pricingToKeep = await createPricingForOrganization({ organizationId });

      const createdCollection = await createTestCollectionWithPricings(
        { _organizationId: organizationId },
        [pricingToRemove.serviceName, pricingToKeep.serviceName]
      );

      const res = await request(app)
        .delete(
          `${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(createdCollection.slug)}/pricings/${encodeURIComponent(pricingToRemove.serviceName)}`
        )
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Pricing removed from collection successfully.' });

      const refreshedCollection = await request(app)
        .get(
          `${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(createdCollection.slug)}`
        )
        .set('Authorization', `Bearer ${owner.token}`);

      expect(refreshedCollection.status).toBe(200);
      expect(Array.isArray(refreshedCollection.body.data.pricings)).toBe(true);

      const remainingNames = refreshedCollection.body.data.pricings.map((pricing: any) => pricing.name);
      expect(remainingNames).toContain(pricingToKeep.serviceName);
      expect(remainingNames).not.toContain(pricingToRemove.serviceName);
    });

    it('returns 404 when the pricing does not belong to the specified collection', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const pricingToRemove = await createPricingForOrganization({ organizationId });
      const sourceCollection = await createTestCollectionWithPricings(
        { _organizationId: organizationId },
        [pricingToRemove.serviceName]
      );
      const targetCollection = await createTestCollection({ _organizationId: organizationId });

      if ((sourceCollection as any)?._id) {
        collectionIdsToDelete.add((sourceCollection as any)._id);
      }

      const res = await request(app)
        .delete(
          `${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(targetCollection.name)}/pricings/${encodeURIComponent(pricingToRemove.serviceName)}`
        )
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(404);
    });

    it('returns 403 when another authenticated user tries to remove the pricing', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: requester } = await createAndLoginUser('USER');

      const pricingToRemove = await createPricingForOrganization({ organizationId });
      const createdCollection = await createTestCollectionWithPricings(
        { _organizationId: organizationId },
        [pricingToRemove.serviceName]
      );

      if ((createdCollection as any)?._id) {
        collectionIdsToDelete.add((createdCollection as any)._id);
      }

      const res = await request(app)
        .delete(
          `${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(createdCollection.slug)}/pricings/${encodeURIComponent(pricingToRemove.serviceName)}`
        )
        .set('Authorization', `Bearer ${requester.token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/collections/:organizationId/:collectionName/download', () => {
    it('Returns 200 and zip content for existing collection', async () => {
      const {user: owner, organizationId} = await createAndLoginUser('USER');

      const testPricing1 = await createPricingForOrganization({ organizationId });
      const testPricing2 = await createPricingForOrganization({ organizationId });

      const collection = await createTestCollectionWithPricings({ _organizationId: organizationId }, [testPricing1.serviceName, testPricing2.serviceName]);

      const res = await request(app)
        .get(
          `${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}/download`
        )
        .set('Authorization', `Bearer ${owner.token}`)
        .buffer(true)
        .parse((resStream, cb) => {
          const chunks: Buffer[] = [];
          resStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          resStream.on('end', () => cb(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toMatch(/zip|application\/zip/);

      const zipBuffer: Buffer = res.body instanceof Buffer ? res.body : Buffer.from(res.body);
      const directory = await unzipper.Open.buffer(zipBuffer);
      const fileNames = directory.files.map(f => f.path);

      expect(fileNames).toEqual(
        expect.arrayContaining([
          `${testPricing1.serviceName}/${testPricing1.version}.yml`,
          `${testPricing2.serviceName}/${testPricing2.version}.yml`,
        ])
      );
    });
    
    it('Returns 400 if existing is empty', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const collection = await createTestCollection({ _organizationId: organizationId });

      const res = await request(app)
        .get(
          `${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}/download`
        )
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
    
    it('Returns 403 if colleciton is private', async () => {
      const { organizationId } = await createAndLoginUser('USER');

      const collection = await createTestCollection({ _organizationId: organizationId, private: true });

      const res = await request(app)
        .get(
          `${BASE_PATH}/collections/${organizationId}/${encodeURIComponent(collection.slug)}/download`
        )
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
    });
    
    it('Returns 404 if collection does not exist', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const res = await request(app)
        .get(
          `${BASE_PATH}/collections/${organizationId}/non-existent/download`
        )
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });
  });
});
