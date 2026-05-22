import dotenv from 'dotenv';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import { createMembership } from './utils/organizations';
import { createPricingForOrganization } from './utils/pricings/pricingTestUtils';
import { createTestCollection } from './utils/collections/collectionTestUtils';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { LeanUser } from '../main/types/models/User';
import EntityPermissionMongoose from '../main/repositories/mongoose/models/EntityPermissionMongoose';
import { createEntityPermission } from './utils/permissions/permissionTestUtils';
import { randomSuffix } from './utils/helpers';

dotenv.config();

describe('Entity Permissions API integration', () => {
  let app: TestApp;
  const adminUser: LeanUser = testContainer.resolve('adminUser');
  const testUser: LeanUser = testContainer.resolve('testUser');
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');

  beforeAll(async () => {
    app = testContainer.resolve('app');
  });

  afterEach(async () => {
    for (const username of usersToDelete) {
      await deleteTestUser(username);
    }
    usersToDelete.clear();
    await EntityPermissionMongoose.deleteMany({});
  });

  afterAll(async () => {
    await shutdownApp();
  });

  describe('POST /api/v1/orgs/:orgId/permissions', () => {
    it('should allow OWNER to set entity permissions', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'pricing',
          entityId: pricing.response.body.id,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      expect(response.status).toBe(201);
      expect(response.body.permissions).toEqual({
        GET: true,
        CREATE: false,
        PUT: false,
        DELETE: false,
      });
    });
    
    it('should allow OWNER to set organization permissions on pricings', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'pricing',
          entityId: null,
          permissions: { CREATE: true },
        });

      expect(response.status).toBe(201);
      expect(response.body.permissions).toEqual({
        GET: false,
        CREATE: true,
        PUT: false,
        DELETE: false,
      });
    });
    
    it('should allow OWNER to set organization permissions on collections', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'collection',
          entityId: null,
          permissions: { CREATE: true },
        });

      expect(response.status).toBe(201);
      expect(response.body.permissions).toEqual({
        GET: false,
        CREATE: true,
        PUT: false,
        DELETE: false,
      });
    });

    it('should deny MEMBER from setting entity permissions', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: member1 } = await createAndLoginUser('USER');
      const { user: member2 } = await createAndLoginUser('USER');
      await createMembership(member1.id, organizationId, 'MEMBER');
      await createMembership(member2.id, organizationId, 'MEMBER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${member1.token}`)
        .send({
          userId: member2.id,
          entityType: 'pricing',
          entityId: pricing.response.body.id,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      expect(response.status).toBe(403);
    });

    it('should return 422 for invalid permission data', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: 'invalid-id',
          entityType: 'invalid',
          entityId: 'invalid',
          permissions: 'not-an-object',
        });

      expect(response.status).toBe(422);
    });
  });

  describe('GET /api/v1/orgs/:orgId/permissions', () => {
    it('should return all permissions for an organization', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'pricing',
          entityId: pricing.response.body.id,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0].entityType).toBe('pricing');
    });

    it('should filter by entityType', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });
      const collection = await createTestCollection({ _organizationId: organizationId });

      await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'pricing',
          entityId: pricing.response.body.id,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'collection',
          entityId: collection.id,
          permissions: { GET: true, PUT: true, DELETE: false },
        });

      const pricingResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=pricing`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(pricingResponse.status).toBe(200);
      expect(pricingResponse.body.length).toBe(1);
      expect(pricingResponse.body[0].entityType).toBe('pricing');

      const collectionResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=collection`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(collectionResponse.status).toBe(200);
      expect(collectionResponse.body.length).toBe(1);
      expect(collectionResponse.body[0].entityType).toBe('collection');
    });

    it('should resolve entityName when entityId is a pricing name (not an ObjectId)', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const createResponse = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'pricing',
          entityId: pricing.serviceName,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      expect(createResponse.status).toBe(201);

      const getResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.length).toBe(1);
      expect(getResponse.body[0].entityName).toBe(pricing.serviceName);
      expect(getResponse.body[0].entityType).toBe('pricing');
    });

    it('should resolve entityName when entityId is a collection name (not an ObjectId)', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const collectionName = 'Test Collection ' + randomSuffix();
      const collection = await createTestCollection({ _organizationId: organizationId, name: collectionName });

      const createResponse = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'collection',
          entityId: collectionName,
          permissions: { GET: true, PUT: true, DELETE: false },
        });

      expect(createResponse.status).toBe(201);

      const getResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.length).toBe(1);
      expect(getResponse.body[0].entityName).toBe(collectionName);
      expect(getResponse.body[0].entityType).toBe('collection');
    });

    it('should resolve entityName when entityId is an ObjectId', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const createResponse = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'pricing',
          entityId: pricing.response.body.id,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      expect(createResponse.status).toBe(201);

      const getResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.length).toBe(1);
      expect(getResponse.body[0].entityName).toBe(pricing.serviceName);
      expect(getResponse.body[0].entityType).toBe('pricing');
    });
  });

  describe('DELETE /api/v1/orgs/:orgId/permissions/:permissionId', () => {
    it('should allow OWNER to remove a permission', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const createResponse = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'pricing',
          entityId: pricing.response.body.id,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      const permissionId = createResponse.body.id;

      const deleteResponse = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/permissions/${permissionId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(deleteResponse.status).toBe(200);
    });
  });

  describe('GET /api/v1/pricings/:orgId/:pricingName/permissions', () => {
    it('should return permissions for the current user on a pricing with OWNER role in the organization', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${pricing.serviceName}/permissions`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        GET: true,
        CREATE: true,
        PUT: true,
        DELETE: true,
      });
    });
    
    it('should return permissions for the current user on a pricing with ADMIN role in the organization', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: requester } = await createAndLoginUser('USER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createMembership(requester.id, organizationId, 'ADMIN');

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${pricing.serviceName}/permissions`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        GET: true,
        CREATE: true,
        PUT: true,
        DELETE: true,
      });
    });
    
    it('should return permissions for the current user on a pricing with MEMBER role in the organization', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: requester } = await createAndLoginUser('USER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createMembership(requester.id, organizationId, 'MEMBER');

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${pricing.serviceName}/permissions`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        GET: false,
        CREATE: false,
        PUT: false,
        DELETE: false,
      });
    });
    
    it('should return permissions for the current user on a pricing with MEMBER role in the organization with false in PUT and DELETE', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: requester } = await createAndLoginUser('USER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });

      await createMembership(requester.id, organizationId, 'MEMBER');
      await createEntityPermission(requester.id, organizationId, 'pricing', pricing.response.body.id, { GET: true, CREATE: false, PUT: false, DELETE: false });

      const response = await request(app)
        .get(`${BASE_PATH}/pricings/${organizationId}/${pricing.serviceName}/permissions`)
        .set('Authorization', `Bearer ${requester.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        GET: true,
        CREATE: false,
        PUT: false,
        DELETE: false,
      });
    });
  });
});
