/**
 * Integration tests for API Keys management
 *
 * This suite exercises the CRUD endpoints for API keys.
 * It verifies that users can create, list, revoke, and delete API keys,
 * and that permission checks work correctly (USER vs ADMIN).
 */

import dotenv from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { BASE_PATH, TEST_PASSWORD } from './utils/config/variables';
import { randomSuffix } from './utils/helpers';
import UserMongoose from '../main/repositories/mongoose/models/UserMongoose';
import OrganizationMongoose from '../main/repositories/mongoose/models/OrganizationMongoose';
import OrganizationMembershipMongoose from '../main/repositories/mongoose/models/OrganizationMembershipMongoose';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import { generateJwtToken } from '../main/utils/users/helpers';
import mongoose from 'mongoose';

dotenv.config();

describe('API Keys management', () => {
  let app: TestApp;
  let regularUser: any;
  let adminUser: any;
  let testOrg: any;

  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const orgsToDelete: Set<string> = testContainer.resolve('orgsToDelete');

  beforeAll(async () => {
    app = testContainer.resolve('app');

    // Create test organization
    const orgDoc = new OrganizationMongoose({
      name: `test_org_${randomSuffix()}`,
      displayName: 'Test Organization',
      description: 'Test org for API key tests',
      isPersonal: false,
      ancestors: [],
    });
    testOrg = await orgDoc.save();
    orgsToDelete.add(testOrg._id.toString());

    // Create regular user
    const regularUsername = `regular_${randomSuffix()}`;
    const regularDoc = new UserMongoose({
      username: regularUsername,
      password: TEST_PASSWORD,
      role: 'USER',
      firstName: 'Regular',
      lastName: 'User',
      email: `${regularUsername}@example.com`,
      tokenExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const savedRegular = await regularDoc.save();
    regularUser = {
      id: savedRegular._id.toString(),
      username: regularUsername,
      token: generateJwtToken({
        id: savedRegular._id.toString(),
        username: regularUsername,
        role: 'USER',
      }),
      role: 'USER',
    };
    usersToDelete.add(regularUsername);

    // Create regular user membership
    await new OrganizationMembershipMongoose({
      _userId: new mongoose.Types.ObjectId(regularUser.id),
      _organizationId: new mongoose.Types.ObjectId(testOrg._id),
      role: 'MEMBER',
      joinedAt: new Date(),
    }).save();

    // Create admin user
    const adminUsername = `admin_${randomSuffix()}`;
    const adminDoc = new UserMongoose({
      username: adminUsername,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      firstName: 'Admin',
      lastName: 'User',
      email: `${adminUsername}@example.com`,
      tokenExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const savedAdmin = await adminDoc.save();
    adminUser = {
      id: savedAdmin._id.toString(),
      username: adminUsername,
      token: generateJwtToken({
        id: savedAdmin._id.toString(),
        username: adminUsername,
        role: 'ADMIN',
      }),
      role: 'ADMIN',
    };
    usersToDelete.add(adminUsername);
  });

  afterAll(async () => {
    // Cleanup
    for (const username of usersToDelete) {
      await UserMongoose.deleteOne({ username });
    }
    for (const orgId of orgsToDelete) {
      await OrganizationMongoose.deleteOne({ _id: orgId });
      await OrganizationMembershipMongoose.deleteMany({ organizationId: orgId });
    }
  });

  describe('POST /users/:username/api-keys', () => {
    it('should create an API key for the authenticated user', async () => {
      const response = await request(app)
        .post(`${BASE_PATH}/users/${regularUser.username}/api-keys`)
        .set('Authorization', `Bearer ${regularUser.token}`)
        .send({
          name: 'Test API Key',
          scopes: [
            {
              organizationId: testOrg._id.toString(),
              scope: 'VIEW',
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.apiKey).toBeDefined();
      expect(response.body.plainKey).toBeDefined();
      expect(response.body.apiKey.name).toBe('Test API Key');
      expect(response.body.apiKey.revoked).toBe(false);
      expect(response.body.plainKey).toMatch(/^sk-/);
    });

    it('should authenticate a newly created API key when creating a collection', async () => {
      const keyResponse = await request(app)
        .post(`${BASE_PATH}/users/${adminUser.username}/api-keys`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          name: 'Collection creation key',
          scopes: [
            {
              organizationId: testOrg._id.toString(),
              scope: 'ALL',
            },
          ],
        });

      expect(keyResponse.status).toBe(201);

      const hashResponse = await request(app)
        .post(`${BASE_PATH}/collections/${testOrg._id.toString()}`)
        .set('x-api-key', keyResponse.body.apiKey.key)
        .send({ name: `rejected_hash_${randomSuffix()}` });

      expect(hashResponse.status).toBe(401);

      const collectionName = `api_key_collection_${randomSuffix()}`;

      try {
        const collectionResponse = await request(app)
          .post(`${BASE_PATH}/collections/${testOrg._id.toString()}`)
          .set('x-api-key', keyResponse.body.plainKey)
          .send({ name: collectionName });

        expect(collectionResponse.status).toBe(201);
        expect(collectionResponse.body.name).toBe(collectionName);
      } finally {
        await PricingCollectionMongoose.deleteOne({
          _organizationId: testOrg._id,
          name: collectionName,
        });
      }
    });

    it('should allow ADMIN to create API key for another user', async () => {
      const response = await request(app)
        .post(`${BASE_PATH}/users/${regularUser.username}/api-keys`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          name: 'Admin Created Key',
          scopes: [
            {
              organizationId: testOrg._id.toString(),
              scope: 'ALL',
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.apiKey.name).toBe('Admin Created Key');
    });

    it('should return 403 when USER tries to create API key for another user', async () => {
      const response = await request(app)
        .post(`${BASE_PATH}/users/${adminUser.username}/api-keys`)
        .set('Authorization', `Bearer ${regularUser.token}`)
        .send({
          name: 'Unauthorized Key',
          scopes: [
            {
              organizationId: testOrg._id.toString(),
              scope: 'VIEW',
            },
          ],
        });

      expect(response.status).toBe(403);
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post(`${BASE_PATH}/users/${regularUser.username}/api-keys`)
        .send({
          name: 'Unauth Key',
          scopes: [
            {
              organizationId: testOrg._id.toString(),
              scope: 'VIEW',
            },
          ],
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /users/:username/api-keys', () => {
    it('should list API keys for the authenticated user', async () => {
      const response = await request(app)
        .get(`${BASE_PATH}/users/${regularUser.username}/api-keys`)
        .set('Authorization', `Bearer ${regularUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].keyPreview).toMatch(/^sk-\.\.\./);
      expect(response.body[0].name).toBeDefined();
      expect(response.body[0].scopes).toBeDefined();
    });

    it('should allow ADMIN to list API keys for another user', async () => {
      const response = await request(app)
        .get(`${BASE_PATH}/users/${regularUser.username}/api-keys`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return 403 when USER tries to list API keys for another user', async () => {
      const response = await request(app)
        .get(`${BASE_PATH}/users/${adminUser.username}/api-keys`)
        .set('Authorization', `Bearer ${regularUser.token}`);

      expect(response.status).toBe(403);
    });
  });

  describe('PUT /users/:username/api-keys/:keyId/revoke', () => {
    let apiKeyToRevoke: any;

    beforeAll(async () => {
      // Create a key to revoke
      const createResponse = await request(app)
        .post(`${BASE_PATH}/users/${regularUser.username}/api-keys`)
        .set('Authorization', `Bearer ${regularUser.token}`)
        .send({
          name: 'Key to Revoke',
          scopes: [
            {
              organizationId: testOrg._id.toString(),
              scope: 'VIEW',
            },
          ],
        });
      apiKeyToRevoke = createResponse.body.apiKey;
    });

    it('should revoke an API key', async () => {
      const response = await request(app)
        .put(
          `${BASE_PATH}/users/${regularUser.username}/api-keys/${apiKeyToRevoke.id}/revoke`
        )
        .set('Authorization', `Bearer ${regularUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('API key revoked');
    });

    it('should return revoked key in list', async () => {
      const response = await request(app)
        .get(`${BASE_PATH}/users/${regularUser.username}/api-keys`)
        .set('Authorization', `Bearer ${regularUser.token}`);

      const revokedKey = response.body.find(
        (k: any) => k.id === apiKeyToRevoke.id
      );
      expect(revokedKey).toBeDefined();
      expect(revokedKey.revoked).toBe(true);
    });
  });

  describe('DELETE /users/:username/api-keys/:keyId', () => {
    let apiKeyToDelete: any;

    beforeAll(async () => {
      // Create a key to delete
      const createResponse = await request(app)
        .post(`${BASE_PATH}/users/${regularUser.username}/api-keys`)
        .set('Authorization', `Bearer ${regularUser.token}`)
        .send({
          name: 'Key to Delete',
          scopes: [
            {
              organizationId: testOrg._id.toString(),
              scope: 'VIEW',
            },
          ],
        });
      apiKeyToDelete = createResponse.body.apiKey;
    });

    it('should delete an API key', async () => {
      const response = await request(app)
        .delete(
          `${BASE_PATH}/users/${regularUser.username}/api-keys/${apiKeyToDelete.id}`
        )
        .set('Authorization', `Bearer ${regularUser.token}`);

      expect(response.status).toBe(204);
    });

    it('should not find deleted key in list', async () => {
      const response = await request(app)
        .get(`${BASE_PATH}/users/${regularUser.username}/api-keys`)
        .set('Authorization', `Bearer ${regularUser.token}`);

      const deletedKey = response.body.find(
        (k: any) => k.id === apiKeyToDelete.id
      );
      expect(deletedKey).toBeUndefined();
    });
  });
});
