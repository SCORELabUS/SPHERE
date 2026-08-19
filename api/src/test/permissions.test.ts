import dotenv from 'dotenv';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import { createMembership, createOrgScopedPermission } from './utils/organizations';
import { createPricingForOrganization } from './utils/pricings/pricingTestUtils';
import { createTestCollection } from './utils/collections/collectionTestUtils';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { LeanUser } from '../main/types/models/User';
import EntityPermissionMongoose from '../main/repositories/mongoose/models/EntityPermissionMongoose';
import { createEntityPermission } from './utils/permissions/permissionTestUtils';
import { randomSuffix, createGlobalAdminUser } from './utils/helpers';

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
          entitySlug: pricing.serviceName,
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
          entitySlug: null,
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
          userId: member1.id,
          entityType: 'pricing',
          entitySlug: pricing.serviceName,
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
          entitySlug: 'invalid',
          permissions: 'not-an-object',
        });

      expect(response.status).toBe(422);
    });
  });

  describe('PUT /api/v1/orgs/:orgId/permissions', () => {
    it('should create multiple permissions for an organization', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });
      const collection = await createTestCollection({ _organizationId: organizationId });

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          permissions: [
            {
              userId: member.id,
              entityType: 'pricing',
              entitySlug: pricing.serviceName,
              permissions: { GET: true, PUT: true },
            },
            {
              userId: member.id,
              entityType: 'collection',
              entitySlug: collection.slug,
              permissions: { GET: true },
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(2);
      expect(response.body.updated).toBe(0);
      expect(response.body.deleted).toBe(0);
      expect(response.body.permissions).toHaveLength(2);
      expect(response.body.permissions[0]).toMatchObject({
        _userId: member.id,
        _organizationId: organizationId,
        entityType: 'pricing',
        entitySlug: pricing.serviceName,
        permissions: { GET: true, PUT: true, DELETE: false, CREATE: false },
      });
      expect(response.body.permissions[1]).toMatchObject({
        _userId: member.id,
        _organizationId: organizationId,
        entityType: 'collection',
        entitySlug: collection.slug,
        permissions: { GET: true, PUT: false, DELETE: false, CREATE: false },
      });
    });

    it('should update existing permissions and create missing permissions together', async () => {
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
          entitySlug: pricing.serviceName,
          permissions: { GET: true, PUT: false, DELETE: false, CREATE: false },
        });

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          permissions: [
            {
              userId: member.id,
              entityType: 'pricing',
              entitySlug: pricing.serviceName,
              permissions: { GET: true, PUT: true, DELETE: true },
            },
            {
              userId: member.id,
              entityType: 'collection',
              entitySlug: null,
              permissions: { CREATE: true },
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);
      expect(response.body.updated).toBe(1);
      expect(response.body.permissions[0].permissions).toEqual({
        GET: true,
        PUT: true,
        DELETE: true,
        CREATE: false,
      });
      expect(response.body.permissions[1]).toMatchObject({
        entityType: 'collection',
        entitySlug: null,
        permissions: { GET: false, PUT: false, DELETE: false, CREATE: true },
      });
      expect(await EntityPermissionMongoose.countDocuments({
        _organizationId: organizationId,
        _userId: member.id,
      })).toBe(2);
    });

    it('should create, update, and remove permissions in one request', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const pricing = await createPricingForOrganization({
        organizationId,
        isPrivate: false,
      });
      const collection = await createTestCollection({ _organizationId: organizationId });

      const pricingPermission = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'pricing',
          entitySlug: pricing.serviceName,
          permissions: { GET: true },
        });
      const removedPermission = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'collection',
          entitySlug: collection.slug,
          permissions: { GET: true },
        });

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          permissions: [
            {
              userId: member.id,
              entityType: 'pricing',
              entitySlug: pricing.serviceName,
              permissions: { GET: true, PUT: true },
            },
            {
              userId: member.id,
              entityType: 'collection',
              entitySlug: null,
              permissions: { CREATE: true },
            },
          ],
          removePermissionIds: [removedPermission.body.id],
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ created: 1, updated: 1, deleted: 1 });
      expect(response.body.permissions).toHaveLength(2);
      expect(await EntityPermissionMongoose.findById(removedPermission.body.id)).toBeNull();
      expect(await EntityPermissionMongoose.findById(pricingPermission.body.id)).toMatchObject({
        permissions: { GET: true, PUT: true, DELETE: false, CREATE: false },
      });
    });

    it('should remove permissions without requiring an upsert', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const permission = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'pricing',
          entitySlug: null,
          permissions: { CREATE: true },
        });

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ removePermissionIds: [permission.body.id] });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        created: 0,
        updated: 0,
        deleted: 1,
        permissions: [],
      });
      expect(await EntityPermissionMongoose.findById(permission.body.id)).toBeNull();
    });

    it('should reject an empty bulk request', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ permissions: [], removePermissionIds: [] });

      expect(response.status).toBe(422);
    });

    it('should reject duplicate permission targets', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const duplicate = {
        userId: member.id,
        entityType: 'pricing',
        entitySlug: null,
        permissions: { CREATE: true },
      };

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ permissions: [duplicate, duplicate] });

      expect(response.status).toBe(422);
      expect(await EntityPermissionMongoose.countDocuments({})).toBe(0);
    });

    it('should validate every entity before writing any permission', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          permissions: [
            {
              userId: member.id,
              entityType: 'collection',
              entitySlug: null,
              permissions: { CREATE: true },
            },
            {
              userId: member.id,
              entityType: 'pricing',
              entitySlug: 'missing-pricing',
              permissions: { GET: true },
            },
          ],
        });

      expect(response.status).toBe(404);
      expect(await EntityPermissionMongoose.countDocuments({})).toBe(0);
    });

    it('should deny MEMBER users from managing permissions in bulk', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({
          permissions: [{
            userId: member.id,
            entityType: 'pricing',
            entitySlug: null,
            permissions: { CREATE: true },
          }],
        });

      expect(response.status).toBe(403);
      expect(await EntityPermissionMongoose.countDocuments({})).toBe(0);
    });

    it('should allow a global ADMIN to manage organization permissions in bulk', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      const globalAdmin = await createGlobalAdminUser();
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${globalAdmin.token}`)
        .send({
          permissions: [{
            userId: member.id,
            entityType: 'pricing',
            entitySlug: null,
            permissions: { CREATE: true },
          }],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);
      expect(response.body.permissions[0].permissions.CREATE).toBe(true);
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
          entitySlug: pricing.serviceName,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=pricing`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
      const memberPerm = response.body.find((p: any) => p._userId === member.id);
      expect(memberPerm.entityType).toBe('pricing');
      const ownerPerm = response.body.find((p: any) => p._userId === owner.id && p.entitySlug === null);
      expect(ownerPerm.permissions.CREATE).toBe(true);
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
          entitySlug: pricing.serviceName,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          userId: member.id,
          entityType: 'collection',
          entitySlug: collection.slug,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      const pricingResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=pricing`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(pricingResponse.status).toBe(200);
      expect(pricingResponse.body.length).toBe(2);
      const pricingTypes = pricingResponse.body.map((p: any) => p.entityType);
      expect(pricingTypes.every((t: string) => t === 'pricing')).toBe(true);

      const collectionResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=collection`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(collectionResponse.status).toBe(200);
      expect(collectionResponse.body.length).toBe(2);
      const collectionTypes = collectionResponse.body.map((p: any) => p.entityType);
      expect(collectionTypes.every((t: string) => t === 'collection')).toBe(true);
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
          entitySlug: pricing.serviceName,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      expect(createResponse.status).toBe(201);

      const getResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=pricing`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.length).toBe(2);
      const memberPerm = getResponse.body.find((p: any) => p._userId === member.id);
      expect(memberPerm.entityName).toBe(pricing.serviceName);
      expect(memberPerm.entityType).toBe('pricing');
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
          entitySlug: collection.slug,
          permissions: { GET: true, PUT: true, DELETE: false },
        });

      expect(createResponse.status).toBe(201);

      const getResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=collection`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.length).toBe(2);
      const memberPerm = getResponse.body.find((p: any) => p._userId === member.id);
      expect(memberPerm.entityName).toBe(collectionName);
      expect(memberPerm.entityType).toBe('collection');
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
          entitySlug: pricing.serviceName,
          permissions: { GET: true, PUT: false, DELETE: false },
        });

      expect(createResponse.status).toBe(201);

      const getResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=pricing`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.length).toBe(2);
      const memberPerm = getResponse.body.find((p: any) => p._userId === member.id);
      expect(memberPerm.entityName).toBe(pricing.serviceName);
      expect(memberPerm.entityType).toBe('pricing');
    });

    it('should return implicit full permissions for OWNER on pricing when no explicit record exists', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=pricing`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0].entityType).toBe('pricing');
      expect(response.body[0].entitySlug).toBeNull();
      expect(response.body[0].permissions).toEqual({
        GET: true,
        CREATE: true,
        PUT: true,
        DELETE: true,
      });
    });

    it('should return implicit full permissions for OWNER on collection when no explicit record exists', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=collection`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
      expect(response.body[0].entityType).toBe('collection');
      expect(response.body[0].entitySlug).toBeNull();
      expect(response.body[0].permissions).toEqual({
        GET: true,
        CREATE: true,
        PUT: true,
        DELETE: true,
      });
    });

    it('should return implicit full permissions for OWNER on both entity types without filter', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(2);
      const types = response.body.map((p: any) => p.entityType).sort();
      expect(types).toEqual(['collection', 'pricing']);
      for (const perm of response.body) {
        expect(perm.entitySlug).toBeNull();
        expect(perm.permissions).toEqual({
          GET: true,
          CREATE: true,
          PUT: true,
          DELETE: true,
        });
      }
    });

    it('should return implicit full permissions for ADMIN of the organization', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: adminMember } = await createAndLoginUser('USER');
      await createMembership(adminMember.id, organizationId, 'ADMIN');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=pricing`)
        .set('Authorization', `Bearer ${adminMember.token}`);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
      expect(response.body[0].entityType).toBe('pricing');
      expect(response.body[0].entitySlug).toBeNull();
      expect(response.body[0].permissions).toEqual({
        GET: true,
        CREATE: true,
        PUT: true,
        DELETE: true,
      });
    });

    it('should return empty array for MEMBER with no explicit permissions', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=pricing`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(0);
    });

    it('should return only explicit permissions for MEMBER with org-scoped permissions', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');
      await createOrgScopedPermission(member.id, organizationId, 'pricing', {
        GET: true,
        CREATE: false,
        PUT: false,
        DELETE: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=pricing`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
      expect(response.body[0].permissions).toEqual({
        GET: true,
        CREATE: false,
        PUT: false,
        DELETE: false,
      });
    });

    it('should not duplicate implicit permissions when OWNER already has an explicit org-scoped record', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      await createOrgScopedPermission(owner.id, organizationId, 'pricing', {
        GET: true,
        CREATE: true,
        PUT: false,
        DELETE: false,
      });

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=pricing`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      const orgScoped = response.body.filter(
        (p: any) => p.entitySlug === null && p._userId === owner.id
      );
      expect(orgScoped.length).toBe(1);
      expect(orgScoped[0].permissions).toEqual({
        GET: true,
        CREATE: true,
        PUT: false,
        DELETE: false,
      });
    });

    it('should return implicit full permissions for global ADMIN on any organization', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const globalAdmin = await createGlobalAdminUser();

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/permissions?entityType=pricing`)
        .set('Authorization', `Bearer ${globalAdmin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
      expect(response.body[0].entityType).toBe('pricing');
      expect(response.body[0].entitySlug).toBeNull();
      expect(response.body[0].permissions).toEqual({
        GET: true,
        CREATE: true,
        PUT: true,
        DELETE: true,
      });
      await deleteTestUser(globalAdmin.username);
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
          entitySlug: pricing.serviceName,
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
      await createEntityPermission(requester.id, organizationId, 'pricing', pricing.serviceName, { GET: true, CREATE: false, PUT: false, DELETE: false });

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
