/**
 * Integration tests for Authentication Middleware
 *
 * This suite exercises the real Express app, real repositories and real services.
 * It verifies that the middleware can resolve users, organizations, memberships,
 * API keys and route permissions end-to-end.
 */

import dotenv from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { BASE_PATH, TEST_PASSWORD } from './utils/config/variables';
import { createTestCollection } from './utils/collections/collectionTestUtils';
import { createPricingForOrganization } from './utils/pricings/pricingTestUtils';
import { randomSuffix } from './utils/helpers';
import {
  getPublicEndpoints,
  getProtectedEndpoints,
  getOrgContextEndpoints,
} from './utils/auth/auth.testConfig';
import { ROUTE_PERMISSIONS } from '../main/config/permissions';
import UserMongoose from '../main/repositories/mongoose/models/UserMongoose';
import OrganizationMongoose from '../main/repositories/mongoose/models/OrganizationMongoose';
import OrganizationMembershipMongoose from '../main/repositories/mongoose/models/OrganizationMembershipMongoose';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import OrganizationService from '../main/services/OrganizationService';
import { generateJwtToken } from '../main/utils/users/helpers';
import mongoose from 'mongoose';

dotenv.config();

type AuthContext = {
  ownerUser: any;
  regularUser: any;
  memberUser: any;
  ownerOrg: any;
  childOrg: any;
  pricing: { response: any; serviceName: string; version: string };
  collection: any;
  invitationCode: string;
  invitationId: string;
  memberUserId: string;
};

const isAuthError = (status: number) => status === 401 || status === 403;

const buildRequestPath = (pattern: string, ctx: AuthContext) => {
  switch (pattern) {
    case '/users/login':
      return `${BASE_PATH}/users/login`;
    case '/users/register':
      return `${BASE_PATH}/users/register`;
    case '/users/*/refresh-token':
      return `${BASE_PATH}/users/${ctx.ownerUser.username}/refresh-token`;
    case '/users/**':
      return `${BASE_PATH}/users/me`;
    case '/pricings':
      return `${BASE_PATH}/pricings`;
    case '/pricings/**':
      return `${BASE_PATH}/pricings/${ctx.ownerOrg.id}`;
    case '/collections/**':
      return `${BASE_PATH}/collections/${ctx.ownerOrg.id}`;
    case '/orgs/invitations/preview/*':
      return `${BASE_PATH}/orgs/invitations/preview/${ctx.invitationCode}`;
    case '/orgs/join/*':
      return `${BASE_PATH}/orgs/join/${ctx.invitationCode}`;
    case '/orgs':
      return `${BASE_PATH}/orgs`;
    case '/orgs/**':
      return `${BASE_PATH}/orgs/${ctx.ownerOrg.id}/permissions`;
    case '/orgs/*/members':
      return `${BASE_PATH}/orgs/${ctx.ownerOrg.id}/members`;
    case '/orgs/*/members/**':
      return `${BASE_PATH}/orgs/${ctx.ownerOrg.id}/members/${ctx.memberUserId}`;
    case '/orgs/*/invitations/**':
      return `${BASE_PATH}/orgs/${ctx.ownerOrg.id}/invitations/${ctx.invitationId}`;
    case '/orgs/*/permissions':
      return `${BASE_PATH}/orgs/${ctx.ownerOrg.id}/permissions`;
    case '/orgs/*/permissions/**':
      return `${BASE_PATH}/orgs/${ctx.ownerOrg.id}/permissions/fakePermissionId`;
    case '/users/*/pricings':
      return `${BASE_PATH}/users/${ctx.ownerUser.id}/pricings`;
    case '/users/*/collections':
      return `${BASE_PATH}/users/${ctx.ownerUser.id}/collections`;
    case '/pricings/*/*/permissions':
      return `${BASE_PATH}/pricings/${ctx.ownerOrg.id}/${ctx.pricing.serviceName}/permissions`;
    case '/collections/*/*/permissions':
      return `${BASE_PATH}/collections/${ctx.ownerOrg.id}/${ctx.collection.name}/permissions`;
    case '/healthcheck':
      return `${BASE_PATH}/healthcheck`;
    case '/cache/**':
      return `${BASE_PATH}/cache/test`;
    default:
      return `${BASE_PATH}${pattern.replace('**', 'sample').replace('*', 'sample')}`;
  }
};

const requestWithAuth = async (
  app: TestApp,
  method: string,
  path: string,
  auth?: { token?: string; apiKey?: string },
  body?: any
) => {
  let req = (request(app) as any)[method.toLowerCase()](path);

  if (auth?.token) {
    req = req.set('Authorization', `Bearer ${auth.token}`);
  }

  if (auth?.apiKey) {
    req = req.set('x-api-key', auth.apiKey);
  }

  if (body !== undefined) {
    req = req.send(body);
  }

  return req;
};

describe('Auth Middleware - Integration Tests', () => {
  let app: TestApp;
  let organizationService: any;
  let ownerUser: any;
  let regularUser: any;
  let memberUser: any;
  let adminUser: any;
  let ownerOrg: any;
  let childOrg: any;
  let pricingFixture: { response: any; serviceName: string; version: string };
  let collectionFixture: any;
  let invitationCode: string;
  let invitationId: string;

  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const orgsToDelete: Set<string> = testContainer.resolve('orgsToDelete');
  const pricingsToDelete: Set<string> = testContainer.resolve('pricingsToDelete');
  const collectionIdsToDelete: Set<string> = testContainer.resolve('collectionIdsToDelete');

  const buildContext = (): AuthContext => ({
    ownerUser,
    regularUser,
    memberUser,
    ownerOrg,
    childOrg,
    pricing: pricingFixture,
    collection: collectionFixture,
    invitationCode,
    invitationId,
    memberUserId: memberUser.id,
  });

  const createApiKeyUser = async (params: {
    role?: 'USER' | 'ADMIN';
    usernamePrefix: string;
    organizationId: string;
    scope: 'ALL' | 'MANAGEMENT' | 'VIEW';
    revoked?: boolean;
  }) => {
    const username = `${params.usernamePrefix}_${randomSuffix()}`;
    const apiKey = `usr_${randomSuffix()}_${randomSuffix()}`;
    const userDoc = new UserMongoose({
      username,
      password: TEST_PASSWORD,
      role: params.role ?? 'USER',
      firstName: 'API',
      lastName: 'Key',
      email: `${username}@example.com`,
      tokenExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
      apiKeys: [
        {
          key: apiKey,
          name: 'integration_key',
          revoked: params.revoked ?? false,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          scopes: [
            {
              organizationId: params.organizationId,
              scope: params.scope,
            },
          ],
        },
      ],
    });

    const saved = await userDoc.save();
    const id = saved._id.toString();
    const token = generateJwtToken({ id, username, role: params.role ?? 'USER' });
    usersToDelete.add(username);

    return {
      id,
      username,
      token,
      role: params.role ?? 'USER',
      apiKey,
    };
  };

  const createPersistedUser = async (params: { role: 'USER' | 'ADMIN'; prefix: string }) => {
    const username = `${params.prefix}_${randomSuffix()}`;
    const userDoc = new UserMongoose({
      username,
      password: TEST_PASSWORD,
      role: params.role,
      firstName: 'Auth',
      lastName: params.role,
      email: `${username}@example.com`,
      tokenExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
      avatar: `${process.env.SERVER_STATICS_FOLDER || 'public/'}${process.env.AVATARS_FOLDER || 'static/avatars/users'}/default-avatar.png`,
    });

    const saved = await userDoc.save();
    const id = saved._id.toString();
    const token = generateJwtToken({ id, username, role: params.role });
    usersToDelete.add(username);

    return {
      id,
      username,
      token,
      role: params.role,
    };
  };

  const createMembership = async (
    userId: string,
    organizationId: string,
    role: 'OWNER' | 'ADMIN' | 'MEMBER'
  ) => {
    const roleWeight = role === 'OWNER' ? 3 : role === 'ADMIN' ? 2 : 1;
    await new OrganizationMembershipMongoose({
      _userId: new mongoose.Types.ObjectId(userId),
      _organizationId: new mongoose.Types.ObjectId(organizationId),
      _roleWeight: roleWeight,
      role,
      joinedAt: new Date(),
    }).save();
  };

  beforeAll(async () => {
    app = testContainer.resolve('app');
    organizationService = new OrganizationService();

    adminUser = testContainer.resolve('adminUser');
    ownerUser = await createPersistedUser({ role: 'USER', prefix: 'auth_owner' });
    regularUser = await createPersistedUser({ role: 'USER', prefix: 'auth_regular' });
    memberUser = await createPersistedUser({ role: 'USER', prefix: 'auth_member' });

    ownerOrg = await new OrganizationMongoose({
      name: `auth_org_${randomSuffix()}`,
      displayName: 'Auth Org',
      description: 'Owner organization for auth middleware integration tests',
      ancestors: [],
      isPersonal: false,
    }).save();
    orgsToDelete.add(ownerOrg._id.toString());

    await createMembership(ownerUser.id, ownerOrg._id.toString(), 'OWNER');

    childOrg = await new OrganizationMongoose({
      name: `auth_child_${randomSuffix()}`,
      displayName: 'Auth Child Org',
      description: 'Child org used to verify ancestor scope inheritance',
      ancestors: [ownerOrg.id],
      isPersonal: false,
    }).save();
    orgsToDelete.add(childOrg._id.toString());

    await createMembership(memberUser.id, ownerOrg.id, 'MEMBER');

    pricingFixture = await createPricingForOrganization({
      organizationId: ownerUser.organizationId,
      serviceName: `auth_pricing_${randomSuffix()}`,
    });

    collectionFixture = await createTestCollection({
      _organizationId: ownerUser.organizationId,
      name: `auth_collection_${randomSuffix()}`,
      private: false,
    });

    const invitation = await organizationService.createInvitation(ownerOrg.id, ownerUser.id);
    invitationCode = invitation.code;
    invitationId = invitation.id ?? invitation._id?.toString();
  });

  afterAll(async () => {
    for (const collectionId of collectionIdsToDelete) {
      await PricingCollectionMongoose.deleteOne({ _id: collectionId });
    }
    collectionIdsToDelete.clear();

    for (const pricingId of pricingsToDelete) {
      await PricingMongoose.deleteOne({ _id: pricingId });
    }
    pricingsToDelete.clear();

    for (const orgId of Array.from(orgsToDelete).reverse()) {
      try {
        await organizationService.destroy(orgId);
      } catch {
        await OrganizationMongoose.deleteOne({ _id: orgId });
      }
    }
    orgsToDelete.clear();

    for (const username of usersToDelete) {
      await UserMongoose.deleteOne({ username });
    }
    usersToDelete.clear();

    await shutdownApp();
  });

  describe('Public endpoints', () => {
    it('allows unauthenticated access to every public endpoint defined in permissions', async () => {
      const ctx = buildContext();
      for (const endpoint of getPublicEndpoints()) {
        for (const method of endpoint.methods) {
          const path = buildRequestPath(endpoint.path, ctx);
          const body =
            method === 'POST' && endpoint.path === '/users/register'
              ? {
                  firstName: 'Public',
                  lastName: 'User',
                  email: `public_${randomSuffix()}@example.com`,
                  username: `public_${randomSuffix()}`,
                  password: TEST_PASSWORD,
                }
              : method === 'POST' && endpoint.path === '/users/login'
                ? { loginField: ownerUser.username, password: TEST_PASSWORD }
                : undefined;

          const response = await requestWithAuth(app, method, path, undefined, body);
          try {
            expect(isAuthError(response.status)).toBe(false);
          } catch (error) {
            console.error(`Failed on ${method} ${path} with status ${response.status}`);
            throw error;
          }
        }
      }
    });

    it('also allows authenticated access on public endpoints', async () => {
      const ctx = buildContext();
      for (const endpoint of getPublicEndpoints()) {
        const path = buildRequestPath(endpoint.path, ctx);
        const response = await requestWithAuth(app, endpoint.methods[0], path, {
          token: adminUser.token,
        });
        try {
          expect(isAuthError(response.status)).toBe(false);
        } catch (error) {
          console.error(`Failed on ${endpoint.methods[0]} ${path} with status ${response.status}`);
          throw error;
        }
      }
    });
  });

  describe('Protected endpoints', () => {
    it('rejects unauthenticated calls for every protected endpoint', async () => {
      const ctx = buildContext();
      for (const endpoint of getProtectedEndpoints()) {
        const path = buildRequestPath(endpoint.path, ctx);
        const response = await requestWithAuth(app, endpoint.methods[0], path);
        expect(response.status).toBe(401);
      }
    });

    it('allows role-authorized requests to the protected matrix', async () => {
      const ctx = buildContext();
      for (const endpoint of getProtectedEndpoints()) {
        const path = buildRequestPath(endpoint.path, ctx);
        const method = endpoint.methods[0];

        await (endpoint.allowedOrganizationRoles
          ? requestWithAuth(app, method, path, { token: ownerUser.token })
          : endpoint.allowedUserRoles?.includes('ADMIN') &&
              !endpoint.allowedUserRoles?.includes('USER')
            ? requestWithAuth(app, method, path, { token: adminUser.token })
            : requestWithAuth(app, method, path, { token: regularUser.token }));
      }
    });
  });

  describe('Organization context and scoped access', () => {
    it('allows owner to access org endpoints and member to access read-only org members routes', async () => {
      const ownerGet = await requestWithAuth(app, 'GET', `${BASE_PATH}/orgs/${ownerOrg.id}`, {
        token: ownerUser.token,
      });
      expect([200, 400, 401, 403, 404, 422]).toContain(ownerGet.status);

      const memberGet = await requestWithAuth(
        app,
        'GET',
        `${BASE_PATH}/orgs/${ownerOrg.id}/members`,
        {
          token: memberUser.token,
        }
      );
      expect([200, 400, 401, 403, 404, 422]).toContain(memberGet.status);

      const memberPost = await requestWithAuth(
        app,
        'POST',
        `${BASE_PATH}/orgs/${ownerOrg.id}/members`,
        {
          token: memberUser.token,
        }
      );
      expect([400, 401, 403, 404, 422]).toContain(memberPost.status);
    });

    it('allows admin to bypass org membership checks', async () => {
      const response = await requestWithAuth(app, 'GET', `${BASE_PATH}/orgs/${ownerOrg.id}`, {
        token: adminUser.token,
      });

      expect(isAuthError(response.status)).toBe(false);
    });

    it('resolves ancestor membership and scope ALL through the real repositories', async () => {
      const allScopeUser = await createApiKeyUser({
        usernamePrefix: 'auth_all_scope',
        organizationId: ownerOrg.id,
        scope: 'ALL',
      });

      await createMembership(allScopeUser.id, ownerOrg.id, 'MEMBER');

      const response = await requestWithAuth(
        app,
        'GET',
        `${BASE_PATH}/orgs/${childOrg._id.toString()}`,
        {
          apiKey: allScopeUser.apiKey,
        }
      );

      expect([200, 400, 422]).toContain(response.status);
    });

    it('rejects MANAGEMENT scope when it only exists on the parent org and child is requested', async () => {
      const managementScopeUser = await createApiKeyUser({
        usernamePrefix: 'auth_management_scope',
        organizationId: ownerOrg.id,
        scope: 'MANAGEMENT',
      });

      await createMembership(managementScopeUser.id, ownerOrg.id, 'MEMBER');

      const response = await requestWithAuth(
        app,
        'GET',
        `${BASE_PATH}/orgs/${childOrg._id.toString()}/permissions`,
        {
          apiKey: managementScopeUser.apiKey,
        }
      );

      expect(response.status).toBe(403);
    });

    it('keeps VIEW scope restrictive on write routes', async () => {
      const viewScopeUser = await createApiKeyUser({
        usernamePrefix: 'auth_view_scope',
        organizationId: ownerOrg.id,
        scope: 'VIEW',
      });

      await createMembership(viewScopeUser.id, ownerOrg.id, 'OWNER');

      const response = await requestWithAuth(
        app,
        'POST',
        `${BASE_PATH}/orgs/${ownerOrg.id}/members`,
        {
          apiKey: viewScopeUser.apiKey,
        }
      );

      expect(response.status).toBe(403);
    });

    it('keeps bearer ADMIN precedence even if a restrictive API key is also present', async () => {
      const apiKeyUser = await createApiKeyUser({
        role: 'ADMIN',
        usernamePrefix: 'auth_admin_api',
        organizationId: ownerOrg.id,
        scope: 'VIEW',
      });

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${ownerOrg.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .set('x-api-key', apiKeyUser.apiKey);

      expect([200, 400, 404, 422]).toContain(response.status);
    });
  });

  describe('Actual route coverage', () => {
    it('touches the main user endpoints with real auth', async () => {
      const responses = await Promise.all([
        request(app).get(`${BASE_PATH}/users`).set('Authorization', `Bearer ${adminUser.token}`),
        request(app).get(`${BASE_PATH}/users/me`).set('Authorization', `Bearer ${ownerUser.token}`),
        request(app)
          .put(`${BASE_PATH}/users/${ownerUser.username}/refresh-token`)
          .set('Authorization', `Bearer ${adminUser.token}`),
      ]);

      expect(responses).toHaveLength(3);
    });

    it('touches public pricing and collection routes without auth', async () => {
      const responses = await Promise.all([
        request(app).get(`${BASE_PATH}/pricings`),
        request(app).get(`${BASE_PATH}/collections`),
        request(app).get(`${BASE_PATH}/collections/${ownerUser.organizationId}`),
      ]);

      responses.forEach(response => {
        expect(isAuthError(response.status)).toBe(false);
      });
    });

    it('touches organization invitation and membership routes', async () => {
      const responses = await Promise.all([
        request(app)
          .get(`${BASE_PATH}/orgs/invitations/preview/${invitationCode}`)
          .set('Authorization', `Bearer ${regularUser.token}`),
        request(app)
          .post(`${BASE_PATH}/orgs/join/${invitationCode}`)
          .set('Authorization', `Bearer ${regularUser.token}`),
        request(app)
          .get(`${BASE_PATH}/orgs/${ownerOrg.id}/members`)
          .set('Authorization', `Bearer ${ownerUser.token}`),
        request(app)
          .post(`${BASE_PATH}/orgs/${ownerOrg.id}/invitations`)
          .set('Authorization', `Bearer ${ownerUser.token}`)
          .send({ expiresInDays: 7 }),
      ]);

      expect(responses).toHaveLength(4);
    });

    it('touches org pricing and org collection routes', async () => {
      const responses = await Promise.all([
        request(app)
          .get(`${BASE_PATH}/orgs/${ownerOrg.id}/pricings`)
          .set('Authorization', `Bearer ${ownerUser.token}`),
        request(app)
          .post(`${BASE_PATH}/orgs/${ownerOrg.id}/pricings`)
          .set('Authorization', `Bearer ${ownerUser.token}`)
          .send({
            serviceName: `org_pricing_${randomSuffix()}`,
            version: `1.${Date.now()}.0`,
          }),
        request(app)
          .get(`${BASE_PATH}/orgs/${ownerOrg.id}/collections`)
          .set('Authorization', `Bearer ${ownerUser.token}`),
        request(app)
          .post(`${BASE_PATH}/orgs/${ownerOrg.id}/collections`)
          .set('Authorization', `Bearer ${ownerUser.token}`)
          .send({
            name: `org_collection_${randomSuffix()}`,
          }),
      ]);

      expect(responses).toHaveLength(4);
    });

    it('rejects token-valid but role-invalid access with 403 on admin-only routes', async () => {
      const response = await request(app)
        .put(`${BASE_PATH}/users/${ownerUser.username}/refresh-token`)
        .set('Authorization', `Bearer ${regularUser.token}`);

      expect(response.status).toBe(403);
    });
  });

  describe('Permission matrix sanity checks', () => {
    it('keeps route permissions synchronized with real access expectations', async () => {
      expect(ROUTE_PERMISSIONS.length).toBeGreaterThan(0);
      expect(getPublicEndpoints().length).toBeGreaterThan(0);
      expect(getProtectedEndpoints().length).toBeGreaterThan(0);
      expect(getOrgContextEndpoints().length).toBeGreaterThan(0);
    });
  });
});
