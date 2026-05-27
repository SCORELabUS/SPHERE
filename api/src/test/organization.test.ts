import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import { BASE_PATH } from './utils/config/variables';
import testContainer from './utils/config/testContainer';
import { createAndLoginUser, createTestUser, deleteTestUser } from './utils/users/userTestUtils';
import { createTestOrganization, createMembership, createTestInvitation, cleanupOrganization } from './utils/organizations/organizationTestUtils';
import { randomSuffix } from './utils/helpers';
import { LeanUser } from '../main/types/models/User';
import OrganizationMembershipMongoose from '../main/repositories/mongoose/models/OrganizationMembershipMongoose';
import OrganizationInvitationMongoose from '../main/repositories/mongoose/models/OrganizationInvitationMongoose';
import OrganizationMongoose from '../main/repositories/mongoose/models/OrganizationMongoose';

dotenv.config();

describe('Organizations API integration', () => {
  let app: TestApp;
  const adminUser: LeanUser = testContainer.resolve('adminUser');
  const testUser: LeanUser = testContainer.resolve('testUser');
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const orgsToDelete: Set<string> = testContainer.resolve('orgsToDelete');
  const membershipsToDelete: Set<string> = testContainer.resolve('membershipsToDelete');
  const invitationsToDelete: Set<string> = testContainer.resolve('invitationsToDelete');

  beforeAll(async () => {
    app = testContainer.resolve('app');
  });

  afterEach(async () => {
    for (const username of usersToDelete) {
      await deleteTestUser(username);
    }
    usersToDelete.clear();

    for (const orgId of orgsToDelete) {
      await cleanupOrganization(orgId);
    }
    orgsToDelete.clear();
    membershipsToDelete.clear();
    invitationsToDelete.clear();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  // =========================================================================
  // GET /orgs
  // =========================================================================
  describe('GET /orgs', () => {
    it('returns 200 and array of organizations with ADMIN role', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      const ids = response.body.map((o: any) => o.id);
      expect(ids).toContain(organizationId);
    });

    it('returns organizations sorted by creation date (newest first)', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const org1 = await createTestOrganization(owner.token, { name: `org_a_${randomSuffix()}`, displayName: 'Org A' });
      const org2 = await createTestOrganization(owner.token, { name: `org_b_${randomSuffix()}`, displayName: 'Org B' });

      const response = await request(app)
        .get(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      const ids = response.body.map((o: any) => o.id);
      const idx1 = ids.indexOf(org1.id);
      const idx2 = ids.indexOf(org2.id);
      expect(idx2).toBeLessThan(idx1);
    });

    it('returns each organization with expected fields', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token, {
        displayName: 'Field Check Org',
        description: 'A test org for field validation',
      });

      const response = await request(app)
        .get(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      const found = response.body.find((o: any) => o.id === org.id);
      expect(found).toBeDefined();
      expect(found.name).toBeDefined();
      expect(found.displayName).toBe('Field Check Org');
      expect(found.description).toBe('A test org for field validation');
      expect(found.isPersonal).toBe(false);
      expect(found.createdAt).toBeDefined();
      expect(found.updatedAt).toBeDefined();
    });

    it('returns 403 when USER role tries to list all organizations', async () => {
      const response = await request(app)
        .get(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${testUser.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const response = await request(app)
        .get(`${BASE_PATH}/orgs`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // POST /orgs
  // =========================================================================
  describe('POST /orgs', () => {
    it('returns 201 and creates organization with valid data', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const name = `testorg_${randomSuffix()}`;

      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name,
          displayName: 'Test Organization',
          description: 'A test organization',
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe(name);
      expect(response.body.displayName).toBe('Test Organization');
      expect(response.body.description).toBe('A test organization');
      expect(response.body.isPersonal).toBe(false);
      expect(response.body.id).toBeDefined();
      expect(response.body.createdAt).toBeDefined();

      orgsToDelete.add(response.body.id);
    });

    it('returns 201 and creator is automatically set as OWNER', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `ownercheck_${randomSuffix()}`,
          displayName: 'Owner Check Org',
        });

      expect(response.status).toBe(201);
      orgsToDelete.add(response.body.id);

      const membershipResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${response.body.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(membershipResponse.status).toBe(200);
      const ownerMembership = membershipResponse.body.find((m: any) => m.user?.id === owner.id);
      expect(ownerMembership).toBeDefined();
      expect(ownerMembership.role).toBe('OWNER');
    });

    it('returns 201 when creating personal organization with name auto-set to username', async () => {
      const { user } = await createTestUser('USER');

      const listRes = await request(app)
        .get(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(listRes.status).toBe(200);
      const personalOrg = listRes.body.find((o: any) => o.name === user.username.toLowerCase() && o.isPersonal === true);
      expect(personalOrg).toBeDefined();
      expect(personalOrg.displayName).toContain('Personal');
    });

    it('returns 201 when ADMIN creates organization for themselves', async () => {
      const name = `adminorg_${randomSuffix()}`;

      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          name,
          displayName: 'Admin Created Org',
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe(name);

      orgsToDelete.add(response.body.id);
    });

    it('returns 201 with optional avatarUrl', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `avatarorg_${randomSuffix()}`,
          displayName: 'Avatar Org',
          avatarUrl: 'https://example.com/avatar.png',
        });

      expect(response.status).toBe(201);
      expect(response.body.avatar).toBeDefined();

      orgsToDelete.add(response.body.id);
    });

    it('returns 422 when name is missing for non-personal organization', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          displayName: 'No Name Org',
        });

      expect(response.status).toBe(422);
    });

    it('returns 422 when displayName is missing', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `nodisplay_${randomSuffix()}`,
        });

      expect(response.status).toBe(422);
    });

    it('returns 422 when name contains uppercase characters', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'InvalidUpperCase',
          displayName: 'Invalid Name Org',
        });

      expect(response.status).toBe(422);
    });

    it('returns 422 when name contains spaces', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'invalid name with spaces',
          displayName: 'Spaces In Name',
        });

      expect(response.status).toBe(422);
    });

    it('returns 422 when name is too short (less than 3 characters)', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'ab',
          displayName: 'Short Name Org',
        });

      expect(response.status).toBe(422);
    });

    it('returns 422 when name is too long (more than 50 characters)', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: 'a'.repeat(51),
          displayName: 'Long Name Org',
        });

      expect(response.status).toBe(422);
    });

    it('returns 401 without Authorization header', async () => {
      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .send({
          name: `noauth_${randomSuffix()}`,
          displayName: 'No Auth Org',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // GET /orgs/:organizationId
  // =========================================================================
  describe('GET /orgs/:organizationId', () => {
    it('returns 200 and organization details when OWNER requests', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(organizationId);
      expect(response.body.name).toBe(owner.username);
      expect(response.body.isPersonal).toBe(true);
    });

    it('returns 200 when ADMIN (org role) requests', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: admin } = await createAndLoginUser('USER');
      await createMembership(admin.id, organizationId, 'ADMIN');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(organizationId);
    });

    it('returns 200 when MEMBER (org role) requests', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(organizationId);
    });

    it('returns 200 when global ADMIN requests any organization', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(organizationId);
    });

    it('returns organization with expected fields', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token, {
        displayName: 'Detail Org',
        description: 'An org for detail testing',
      });

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${org.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(org.id);
      expect(response.body.name).toBe(org.name);
      expect(response.body.displayName).toBe('Detail Org');
      expect(response.body.description).toBe('An org for detail testing');
      expect(response.body.isPersonal).toBe(false);
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();
    });

    it('returns 403 when non-member USER requests', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${outsider.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when organization does not exist', async () => {
      const fakeId = '68050bd09890322c57842f6f';

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${fakeId}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // PUT /orgs/:organizationId
  // =========================================================================
  describe('PUT /orgs/:organizationId', () => {
    it('returns 200 when OWNER updates displayName', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ displayName: 'Updated Display Name' });

      expect(response.status).toBe(200);
      expect(response.body.displayName).toBe('Updated Display Name');
      expect(response.body._id).toBe(organizationId);
    });

    it('returns 200 when OWNER updates description', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ description: 'New description' });

      expect(response.status).toBe(200);
      expect(response.body.description).toBe('New description');
    });

    it('returns 200 when OWNER updates avatarUrl', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ avatarUrl: 'https://example.com/new-avatar.png' });

      expect(response.status).toBe(200);
    });

    it('returns 200 when OWNER uploads avatar PNG file and URL is properly formatted', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const sourcePng = path.resolve('public', 'static', 'avatars', 'users', 'default-avatar.png');
      const tmpPng = path.join(os.tmpdir(), `test-avatar-${Date.now()}.png`);
      fs.copyFileSync(sourcePng, tmpPng);

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .attach('avatar', tmpPng);

      expect(response.status).toBe(200);
      expect(response.body.avatar).toBeDefined();
      expect(response.body.avatar).toContain('/avatars/orgs/');
      expect(response.body.avatar).toMatch(/\.(png|jpeg|jpg)$/);
      expect(response.body.avatar).toMatch(/^https?:\/\/.+\/avatars\/orgs\//);

      const avatarRelativePath = response.body.avatar.replace(/^https?:\/\/[^/]+/, '');
      const avatarDiskPath = path.join('public', avatarRelativePath);
      expect(fs.existsSync(avatarDiskPath)).toBe(true);

      const getResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.avatar).toBeDefined();
      expect(getResponse.body.avatar).toContain('/avatars/orgs/');
      expect(getResponse.body.avatar).toMatch(/^https?:\/\/.+\/avatars\/orgs\//);

      fs.unlinkSync(avatarDiskPath);
      fs.unlinkSync(tmpPng);
    });

    it('returns 200 when ADMIN (org role) updates', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${orgAdmin.token}`)
        .send({ displayName: 'Admin Updated' });

      expect(response.status).toBe(200);
      expect(response.body.displayName).toBe('Admin Updated');
    });

    it('returns 200 when global ADMIN updates any organization', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ displayName: 'Global Admin Updated' });

      expect(response.status).toBe(200);
      expect(response.body.displayName).toBe('Global Admin Updated');
    });

    it('returns 200 and allows updating multiple fields at once', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          displayName: 'Multi Update',
          description: 'Updated description',
          avatarUrl: 'https://example.com/new-avatar.png',
        });

      expect(response.status).toBe(200);
      expect(response.body.displayName).toBe('Multi Update');
      expect(response.body.description).toBe('Updated description');
    });

    it('returns 403 when MEMBER (org role) tries to update', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ displayName: 'Member Update' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 403 when non-member USER tries to update', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ displayName: 'Outsider Update' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when organization does not exist', async () => {
      const fakeId = '68050bd09890322c57842f6f';

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${fakeId}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ displayName: 'No Org' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}`)
        .send({ displayName: 'No Auth' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // DELETE /orgs/:organizationId
  // =========================================================================
  describe('DELETE /orgs/:organizationId', () => {
    it('returns 200 when OWNER deletes own organization', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${org.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Successfully deleted.');
      orgsToDelete.delete(org.id);
    });

    it('returns 200 when global ADMIN deletes any organization', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${org.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Successfully deleted.');
      orgsToDelete.delete(org.id);
    });

    it('returns 200 when org ADMIN (not global) deletes organization', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);
      await createMembership(orgAdmin.id, org.id, 'ADMIN');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${org.id}`)
        .set('Authorization', `Bearer ${orgAdmin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Successfully deleted.');
      orgsToDelete.delete(org.id);
    });

    it('returns 200 and cascades deletion of memberships', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);
      await createMembership(member.id, org.id, 'MEMBER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${org.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);

      const membership = await OrganizationMembershipMongoose.findOne({
        _userId: member.id,
        _organizationId: org.id,
      });
      expect(membership).toBeNull();
      orgsToDelete.delete(org.id);
    });

    it('returns 200 and cascades deletion of invitations', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);

      const invitation = await createTestInvitation(org.id, owner.id);

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${org.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);

      const deletedInvitation = await OrganizationInvitationMongoose.findById(invitation.id);
      expect(deletedInvitation).toBeNull();
      orgsToDelete.delete(org.id);
    });

    it('returns 403 when trying to delete a personal organization', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Personal');
    });

    it('returns 403 when MEMBER (org role) tries to delete', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);
      await createMembership(member.id, org.id, 'MEMBER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${org.id}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 403 when non-member USER tries to delete', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${org.id}`)
        .set('Authorization', `Bearer ${outsider.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when organization does not exist', async () => {
      const fakeId = '68050bd09890322c57842f6f';

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${fakeId}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${org.id}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // GET /orgs/:organizationId/members
  // =========================================================================
  describe('GET /orgs/:organizationId/members', () => {
    it('returns 200 and list of members when OWNER requests', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0].role).toBe('OWNER');
      expect(response.body[0].user).toBeDefined();
      expect(response.body[0].user.id).toBe(owner.id);
    });

    it('returns 200 and includes all members with their roles', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(3);
      const roles = response.body.map((m: any) => m.role);
      expect(roles).toContain('OWNER');
      expect(roles).toContain('ADMIN');
      expect(roles).toContain('MEMBER');
    });

    it('returns members with nested user data (id, username, email, avatar)', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      const memberEntry = response.body.find((m: any) => m.user?.id === member.id);
      expect(memberEntry).toBeDefined();
      expect(memberEntry.user.username).toBe(member.username);
      expect(memberEntry.user.email).toBe(member.email);
      expect(memberEntry.user.avatar).toBeDefined();
      expect(typeof memberEntry.user.avatar).toBe('string');
      expect(memberEntry.user).not.toHaveProperty('settings');
    });

    it('returns member avatar colors (avatarBgColor, avatarFgColor)', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      const memberEntry = response.body.find((m: any) => m.user?.id === member.id);
      expect(memberEntry).toBeDefined();
      expect(memberEntry.user).toHaveProperty('avatarBgColor');
      expect(memberEntry.user).toHaveProperty('avatarFgColor');
    });

    it('returns 200 when MEMBER (org role) requests', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('returns 200 when global ADMIN requests', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('returns 403 when non-member USER requests', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${outsider.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when organization does not exist', async () => {
      const fakeId = '68050bd09890322c57842f6f';

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${fakeId}/members`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/members`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // POST /orgs/:organizationId/members
  // =========================================================================
  describe('POST /orgs/:organizationId/members', () => {
    it('returns 201 when OWNER adds a MEMBER', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: newMember } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: newMember.id, role: 'MEMBER' });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe('MEMBER');
      expect(response.body._userId).toBe(newMember.id);
      expect(response.body._organizationId).toBe(organizationId);
    });

    it('returns 201 when OWNER adds an ADMIN', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: newAdmin } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: newAdmin.id, role: 'ADMIN' });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe('ADMIN');
    });

    it('returns 201 when OWNER adds another OWNER', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: newOwner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${org.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: newOwner.id, role: 'OWNER' });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe('OWNER');
    });

    it('returns 201 when org ADMIN adds a member', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      const { user: newMember } = await createAndLoginUser('USER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${orgAdmin.token}`)
        .send({ userId: newMember.id, role: 'MEMBER' });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe('MEMBER');
    });

    it('returns 201 when global ADMIN adds a member', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: newMember } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ userId: newMember.id, role: 'MEMBER' });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe('MEMBER');
    });

    it('returns 422 when user is already a member', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: member.id, role: 'MEMBER' });

      expect(response.status).toBe(422);
      expect(response.body.error).toBeDefined();
    });

    it('returns 422 when role is invalid', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: newMember } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: newMember.id, role: 'INVALID_ROLE' });

      expect(response.status).toBe(422);
    });

    it('returns 422 when userId is missing', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'MEMBER' });

      expect(response.status).toBe(422);
    });

    it('returns 422 when role is missing', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: newMember } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: newMember.id });

      expect(response.status).toBe(422);
    });

    it('returns 403 when org MEMBER tries to add a member', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      const { user: newGuy } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ userId: newGuy.id, role: 'MEMBER' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 403 when non-member USER tries to add a member', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');
      const { user: newGuy } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ userId: newGuy.id, role: 'MEMBER' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 403 when trying to add OWNER to a personal organization', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: newOwner } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: newOwner.id, role: 'OWNER' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Personal');
    });

    it('returns 404 when organization does not exist', async () => {
      const fakeId = '68050bd09890322c57842f6f';
      const { user: newMember } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${fakeId}/members`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ userId: newMember.id, role: 'MEMBER' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: newMember } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/members`)
        .send({ userId: newMember.id, role: 'MEMBER' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // PUT /orgs/:organizationId/members/:userId
  // =========================================================================
  describe('PUT /orgs/:organizationId/members/:userId', () => {
    it('returns 200 when OWNER promotes MEMBER to ADMIN', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('ADMIN');
    });

    it('returns 200 when OWNER demotes ADMIN to MEMBER', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${orgAdmin.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'MEMBER' });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('MEMBER');
    });

    it('returns 200 when OWNER assigns OWNER role', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);
      await createMembership(member.id, org.id, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${org.id}/members/${member.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'OWNER' });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('OWNER');
    });

    it('returns 200 when org ADMIN updates member role', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${orgAdmin.token}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('ADMIN');
    });

    it('returns 200 when global ADMIN updates member role', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('ADMIN');
    });
    
    it('returns 200 when global ADMIN tries to set OWNER role', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);
      await createMembership(member.id, org.id, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${org.id}/members/${member.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ role: 'OWNER' });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('OWNER');
    });

    it('returns 403 when org ADMIN updates member role to OWNER', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${orgAdmin.token}`)
        .send({ role: 'OWNER' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 403 when org ADMIN tries to demote an OWNER to ADMIN', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: otherOwner } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      await createMembership(otherOwner.id, organizationId, 'OWNER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${otherOwner.id}`)
        .set('Authorization', `Bearer ${orgAdmin.token}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('OWNER');
    });

    it('returns 403 when org ADMIN tries to demote an OWNER to MEMBER', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: otherOwner } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      await createMembership(otherOwner.id, organizationId, 'OWNER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${otherOwner.id}`)
        .set('Authorization', `Bearer ${orgAdmin.token}`)
        .send({ role: 'MEMBER' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('OWNER');
    });

    it('returns 200 when OWNER demotes another OWNER (multiple OWNERs)', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: otherOwner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);
      await createMembership(otherOwner.id, org.id, 'OWNER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${org.id}/members/${otherOwner.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('ADMIN');
    });

    it('returns 200 when global ADMIN demotes an OWNER', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: otherOwner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);
      await createMembership(otherOwner.id, org.id, 'OWNER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${org.id}/members/${otherOwner.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('ADMIN');
    });

    it('returns 403 when trying to promote a member to OWNER in a personal organization', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'OWNER' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Personal');
    });

    it('returns 403 when trying to demote the last OWNER to ADMIN', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${owner.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('last owner');
    });

    it('returns 403 when trying to demote the last OWNER to MEMBER', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${org.id}/members/${owner.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'MEMBER' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('last owner');
    });

    it('returns 200 when demoting an OWNER when there are multiple OWNERs', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: otherOwner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);
      await createMembership(otherOwner.id, org.id, 'OWNER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${org.id}/members/${owner.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('ADMIN');
    });

    it('returns 403 when org MEMBER tries to update role', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member1 } = await createAndLoginUser('USER');
      const { user: member2 } = await createAndLoginUser('USER');
      await createMembership(member1.id, organizationId, 'MEMBER');
      await createMembership(member2.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${member2.id}`)
        .set('Authorization', `Bearer ${member1.token}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 403 when non-member USER tries to update role', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when membership does not exist', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: nonMember } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${nonMember.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'MEMBER' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when organization does not exist', async () => {
      const fakeId = '68050bd09890322c57842f6f';
      const { user: member } = await createAndLoginUser('USER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${fakeId}/members/${member.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ role: 'MEMBER' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 422 when role is invalid', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'SUPERUSER' });

      expect(response.status).toBe(422);
    });

    it('returns 422 when role is missing', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({});

      expect(response.status).toBe(422);
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // DELETE /orgs/:organizationId/members/:userId
  // =========================================================================
  describe('DELETE /orgs/:organizationId/members/:userId', () => {
    it('returns 200 when OWNER removes a MEMBER', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Successfully removed.');

      const membership = await OrganizationMembershipMongoose.findOne({
        _userId: member.id,
        _organizationId: organizationId,
      });
      expect(membership).toBeNull();
    });

    it('returns 200 when org ADMIN removes a member', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${orgAdmin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Successfully removed.');
    });

    it('returns 403 when org ADMIN tries to remove an OWNER', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: otherOwner } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      await createMembership(otherOwner.id, organizationId, 'OWNER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${otherOwner.id}`)
        .set('Authorization', `Bearer ${orgAdmin.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('OWNER');
    });

    it('returns 200 when global ADMIN removes an OWNER', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: otherOwner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);
      await createMembership(otherOwner.id, org.id, 'OWNER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${org.id}/members/${otherOwner.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Successfully removed.');
    });

    it('returns 200 when global ADMIN removes a member', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Successfully removed.');
    });

    it('returns 200 and removes the membership record from the database', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      const membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);

      const userIds = membersResponse.body.map((m: any) => m.user?.id);
      expect(userIds).not.toContain(member.id);
    });

    it('returns 403 when org MEMBER tries to remove another member', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: member1 } = await createAndLoginUser('USER');
      const { user: member2 } = await createAndLoginUser('USER');
      await createMembership(member1.id, organizationId, 'MEMBER');
      await createMembership(member2.id, organizationId, 'MEMBER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${member2.id}`)
        .set('Authorization', `Bearer ${member1.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 403 when non-member USER tries to remove a member', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${outsider.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 403 when trying to remove the last OWNER', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${owner.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('last owner');
    });

    it('returns 200 when removing an OWNER when there are multiple OWNERs', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: otherOwner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);
      await createMembership(otherOwner.id, org.id, 'OWNER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${org.id}/members/${owner.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Successfully removed.');

      const membership = await OrganizationMembershipMongoose.findOne({
        _userId: owner.id,
        _organizationId: org.id,
      });
      expect(membership).toBeNull();
    });

    it('returns 404 when membership does not exist', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: nonMember } = await createAndLoginUser('USER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${nonMember.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when organization does not exist', async () => {
      const fakeId = '68050bd09890322c57842f6f';
      const { user: member } = await createAndLoginUser('USER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${fakeId}/members/${member.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });

    it('returns 200 when MEMBER removes themselves (self-removal / leave)', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${member.id}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Successfully removed.');

      const membership = await OrganizationMembershipMongoose.findOne({
        _userId: member.id,
        _organizationId: organizationId,
      });
      expect(membership).toBeNull();
    });

    it('returns 200 when ADMIN removes themselves (self-removal / leave)', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${orgAdmin.id}`)
        .set('Authorization', `Bearer ${orgAdmin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Successfully removed.');
    });

    it('returns 200 when OWNER removes themselves with other OWNERs present', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: otherOwner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token);
      await createMembership(otherOwner.id, org.id, 'OWNER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${org.id}/members/${owner.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Successfully removed.');

      const membership = await OrganizationMembershipMongoose.findOne({
        _userId: owner.id,
        _organizationId: org.id,
      });
      expect(membership).toBeNull();
    });

    it('returns 403 when OWNER tries to remove themselves as last OWNER', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${owner.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('last owner');
    });

    it('returns 403 when MEMBER tries to remove another member', async () => {
      const { organizationId } = await createAndLoginUser('USER');
      const { user: member1 } = await createAndLoginUser('USER');
      const { user: member2 } = await createAndLoginUser('USER');
      await createMembership(member1.id, organizationId, 'MEMBER');
      await createMembership(member2.id, organizationId, 'MEMBER');

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/members/${member2.id}`)
        .set('Authorization', `Bearer ${member1.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // GET /orgs/:organizationId/invitations
  // =========================================================================
  describe('GET /orgs/:organizationId/invitations', () => {
    it('returns 200 and list of invitations when OWNER requests', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
      expect(response.body[0].code).toBe(invitation.code);
    });

    it('returns invitations with expected fields', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      await createTestInvitation(organizationId, owner.id, { expiresInDays: 14, maxUses: 5 });

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      const inv = response.body[0];
      expect(inv.id).toBeDefined();
      expect(inv.code).toBeDefined();
      expect(inv.expiresAt).toBeDefined();
      expect(inv.maxUses).toBe(5);
      expect(inv.useCount).toBe(0);
      expect(inv.createdAt).toBeDefined();
    });

    it('returns 200 when org ADMIN requests', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');
      await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${orgAdmin.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
    });

    it('returns 200 when global ADMIN requests', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('returns 200 and empty array when no invitations exist', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    it('returns 200 when org MEMBER lists invitations (general org GET rule applies)', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');
      await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${member.token}`);

      // MEMBER can list because the general /orgs/** GET rule allows all org members
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('returns 403 when non-member USER tries to list invitations', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${outsider.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when organization does not exist', async () => {
      const fakeId = '68050bd09890322c57842f6f';

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${fakeId}/invitations`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/invitations`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // POST /orgs/:organizationId/invitations
  // =========================================================================
  describe('POST /orgs/:organizationId/invitations', () => {
    it('returns 201 and creates invitation with default options', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.code).toBeDefined();
      expect(response.body.code.length).toBe(10);
      expect(response.body.expiresAt).toBeDefined();
      expect(response.body.maxUses).toBeNull();
      expect(response.body.useCount).toBe(0);
    });

    it('returns 201 with custom expiresInDays', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ expiresInDays: 30 });

      expect(response.status).toBe(201);
      expect(response.body.expiresAt).toBeDefined();
      const expiresAt = new Date(response.body.expiresAt);
      const now = new Date();
      const diffDays = Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(29);
      expect(diffDays).toBeLessThanOrEqual(30);
    });

    it('returns 201 with custom maxUses', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ maxUses: 5 });

      expect(response.status).toBe(201);
      expect(response.body.maxUses).toBe(5);
    });

    it('returns 201 when org ADMIN creates invitation', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${orgAdmin.token}`)
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.code).toBeDefined();
    });

    it('returns 201 when global ADMIN creates invitation', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.code).toBeDefined();
    });

    it('returns 201 and each invitation has a unique code', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const res1 = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({});
      const res2 = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({});

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.code).not.toBe(res2.body.code);
    });

    it('returns 403 when org MEMBER tries to create invitation', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 403 when non-member USER tries to create invitation', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when organization does not exist', async () => {
      const fakeId = '68050bd09890322c57842f6f';

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${fakeId}/invitations`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/${organizationId}/invitations`)
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // DELETE /orgs/:organizationId/invitations/:invitationId
  // =========================================================================
  describe('DELETE /orgs/:organizationId/invitations/:invitationId', () => {
    it('returns 200 when OWNER revokes invitation', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/invitations/${invitation.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Invitation revoked.');

      const dbInvitation = await OrganizationInvitationMongoose.findById(invitation.id);
      expect(dbInvitation).toBeNull();
    });

    it('returns 200 when org ADMIN revokes invitation', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: orgAdmin } = await createAndLoginUser('USER');
      await createMembership(orgAdmin.id, organizationId, 'ADMIN');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/invitations/${invitation.id}`)
        .set('Authorization', `Bearer ${orgAdmin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Invitation revoked.');
    });

    it('returns 200 when global ADMIN revokes invitation', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/invitations/${invitation.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Invitation revoked.');
    });

    it('returns 200 and revocation does not affect users who already joined', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: joiner } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      // Join via invitation first
      const joinRes = await request(app)
        .post(`${BASE_PATH}/orgs/join/${invitation.code}`)
        .set('Authorization', `Bearer ${joiner.token}`);
      expect(joinRes.status).toBe(200);

      // Revoke the invitation
      const revokeRes = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/invitations/${invitation.id}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(revokeRes.status).toBe(200);

      // Verify the joiner is still a member
      const membersRes = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      const joinerMember = membersRes.body.find((m: any) => m.user?.id === joiner.id);
      expect(joinerMember).toBeDefined();
    });

    it('returns 403 when org MEMBER tries to revoke invitation', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/invitations/${invitation.id}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 403 when non-member USER tries to revoke invitation', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: outsider } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/invitations/${invitation.id}`)
        .set('Authorization', `Bearer ${outsider.token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when invitation does not exist', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const fakeInvitationId = '68050bd09890322c57842f72';

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/invitations/${fakeInvitationId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when organization does not exist', async () => {
      const fakeOrgId = '68050bd09890322c57842f6f';
      const fakeInvitationId = '68050bd09890322c57842f72';

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${fakeOrgId}/invitations/${fakeInvitationId}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .delete(`${BASE_PATH}/orgs/${organizationId}/invitations/${invitation.id}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // GET /orgs/invitations/preview/:code
  // =========================================================================
  describe('GET /orgs/invitations/preview/:code', () => {
    it('returns 200 and invitation preview data with valid code', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/invitations/preview/${invitation.code}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.invitation).toBeDefined();
      expect(response.body.organization).toBeDefined();
      expect(response.body.invitation.code).toBe(invitation.code);
      expect(response.body.organization.id).toBe(organizationId);
    });

    it('returns organization info in preview (id, name, displayName, isPersonal)', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/invitations/preview/${invitation.code}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.organization.id).toBe(organizationId);
      expect(response.body.organization.name).toBe(owner.username);
      expect(response.body.organization.displayName).toBeDefined();
      expect(response.body.organization.isPersonal).toBeDefined();
    });

    it('returns 200 when any authenticated user previews', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: otherUser } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/invitations/preview/${invitation.code}`)
        .set('Authorization', `Bearer ${otherUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.invitation.code).toBe(invitation.code);
    });

    it('returns 404 when invitation code does not exist', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/invitations/preview/nonexistentcode`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when invitation is expired', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      // Create an invitation that already expired
      const invitation = await createTestInvitation(organizationId, owner.id, { expiresInDays: -1 });

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/invitations/preview/${invitation.code}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when invitation has reached max uses', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      // Create invitation with maxUses: 1, then use it once
      const invitation = await createTestInvitation(organizationId, owner.id, { maxUses: 1 });
      const { user: joiner } = await createAndLoginUser('USER');
      await request(app)
        .post(`${BASE_PATH}/orgs/join/${invitation.code}`)
        .set('Authorization', `Bearer ${joiner.token}`);

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/invitations/preview/${invitation.code}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/invitations/preview/${invitation.code}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // POST /orgs/join/:code
  // =========================================================================
  describe('POST /orgs/join/:code', () => {
    it('returns 200 and joins organization with valid invitation code', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: joiner } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/join/${invitation.code}`)
        .set('Authorization', `Bearer ${joiner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(organizationId);
    });

    it('returns 200 and user is added as MEMBER role', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: joiner } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      await request(app)
        .post(`${BASE_PATH}/orgs/join/${invitation.code}`)
        .set('Authorization', `Bearer ${joiner.token}`);

      const membersRes = await request(app)
        .get(`${BASE_PATH}/orgs/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);

      const joinerMember = membersRes.body.find((m: any) => m.user?.id === joiner.id);
      expect(joinerMember).toBeDefined();
      expect(joinerMember.role).toBe('MEMBER');
    });

    it('returns 200 and increments invitation useCount', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: joiner } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      await request(app)
        .post(`${BASE_PATH}/orgs/join/${invitation.code}`)
        .set('Authorization', `Bearer ${joiner.token}`);

      const previewRes = await request(app)
        .get(`${BASE_PATH}/orgs/invitations/preview/${invitation.code}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.invitation.useCount).toBe(1);
    });

    it('returns 200 when ADMIN (global) joins via invitation', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/join/${invitation.code}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(organizationId);
    });

    it('returns 422 when user is already a member', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      await createMembership(member.id, organizationId, 'MEMBER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/join/${invitation.code}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(422);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when invitation code does not exist', async () => {
      const { user: joiner } = await createAndLoginUser('USER');

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/join/nonexistentcode`)
        .set('Authorization', `Bearer ${joiner.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when invitation is expired', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: joiner } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id, { expiresInDays: -1 });

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/join/${invitation.code}`)
        .set('Authorization', `Bearer ${joiner.token}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('returns 404 when invitation has reached max uses', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const { user: joiner1 } = await createAndLoginUser('USER');
      const { user: joiner2 } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id, { maxUses: 1 });

      // First join succeeds
      const res1 = await request(app)
        .post(`${BASE_PATH}/orgs/join/${invitation.code}`)
        .set('Authorization', `Bearer ${joiner1.token}`);
      expect(res1.status).toBe(200);

      // Second join fails — max uses reached
      const res2 = await request(app)
        .post(`${BASE_PATH}/orgs/join/${invitation.code}`)
        .set('Authorization', `Bearer ${joiner2.token}`);
      expect(res2.status).toBe(404);
      expect(res2.body.error).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const invitation = await createTestInvitation(organizationId, owner.id);

      const response = await request(app)
        .post(`${BASE_PATH}/orgs/join/${invitation.code}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // GET /users/me/orgs
  // =========================================================================
  describe('GET /users/me/orgs', () => {
    it('returns 200 and array of organizations for authenticated USER', async () => {
      const { user } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
    });
    
    it('returns 200 and array of organizations for authenticated USER', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      await createTestOrganization(user.token, { _parentId: organizationId });
      await createTestOrganization(user.token, { _parentId: organizationId });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(1);
    });

    it('returns 200 for ADMIN user', async () => {
      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('returns the personal organization for the user', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      const ids = response.body.map((o: any) => o.id);
      expect(ids).toContain(organizationId);

      const personalOrg = response.body.find((o: any) => o.id === organizationId);
      expect(personalOrg).toBeDefined();
      expect(personalOrg.isPersonal).toBe(true);
    });

    it('returns only organizations the user belongs to', async () => {
      const { user: user1 } = await createAndLoginUser('USER');
      const { user: user2 } = await createAndLoginUser('USER');
      const org1 = await createTestOrganization(user1.token, { name: `user1org_${randomSuffix()}` });
      const org2 = await createTestOrganization(user2.token, { name: `user2org_${randomSuffix()}` });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(response.status).toBe(200);
      const ids = response.body.map((o: any) => o.id);
      expect(ids).toContain(org1.id);
      expect(ids).not.toContain(org2.id);
    });

    it('returns organizations the user joined via membership', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: joiner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token, { name: `joinable_${randomSuffix()}` });
      await createMembership(joiner.id, org.id, 'MEMBER');

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${joiner.token}`);

      expect(response.status).toBe(200);
      const ids = response.body.map((o: any) => o.id);
      expect(ids).toContain(org.id);
    });

    it('returns organizations with expected fields', async () => {
      const { user } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(response.body.length).toBeGreaterThanOrEqual(1);

      const org = response.body[0];
      expect(org.id).toBeDefined();
      expect(org.name).toBeDefined();
      expect(org.displayName).toBeDefined();
      expect(org.isPersonal).toBeDefined();
    });

    it('returns 401 without Authorization header', async () => {
      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // Role Inheritance (Parent → Child Organizations)
  // =========================================================================
  describe('Role Inheritance for Parent → Child Organizations', () => {
    it('OWNER of parent can access child org via GET /orgs/:id', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      expect(childResponse.status).toBe(201);
      const childId = childResponse.body.id;

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(childId);
    });

    it('OWNER of parent can list members of child org', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('ADMIN of parent can access child org', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: admin } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });
      await createMembership(admin.id, parentOrg.id, 'ADMIN');

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(childId);
    });

    it('MEMBER of parent cannot access child org without direct membership', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });
      await createMembership(member.id, parentOrg.id, 'MEMBER');

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}`)
        .set('Authorization', `Bearer ${member.token}`);

      expect(response.status).toBe(403);
    });

    it('GET /orgs/:id returns populated subOrganizations', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });

      await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child1_${randomSuffix()}`,
          displayName: 'Child 1',
          _parentId: parentOrg.id,
        });

      await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child2_${randomSuffix()}`,
          displayName: 'Child 2',
          _parentId: parentOrg.id,
        });

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${parentOrg.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.subOrganizations).toBeDefined();
      expect(Array.isArray(response.body.subOrganizations)).toBe(true);
      expect(response.body.subOrganizations.length).toBe(2);

      const childNames = response.body.subOrganizations.map((c: any) => c.name);
      const childDisplayNames = response.body.subOrganizations.map((c: any) => c.displayName);
      expect(childDisplayNames).toContain('Child 1');
      expect(childDisplayNames).toContain('Child 2');
      expect(childNames.every((n: string) => n.startsWith('child'))).toBe(true);
    });

    it('child org created via API has correct ancestors', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      expect(childResponse.status).toBe(201);
      expect(childResponse.body._parentId).toBe(parentOrg.id);
      expect(childResponse.body.ancestors).toBeDefined();
      expect(Array.isArray(childResponse.body.ancestors)).toBe(true);
      expect(childResponse.body.ancestors).toContain(parentOrg.id);
    });

    it('OWNER of parent can list members of child via inherited role', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
    });

    it('child org ancestors are persisted in DB and role lookup resolves through hierarchy', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      // Verify ancestors are stored in the DB
      const storedChild = await OrganizationMongoose.findById(childId).lean();
      expect(storedChild).not.toBeNull();
      expect(storedChild!.ancestors).toBeDefined();
      expect(Array.isArray(storedChild!.ancestors)).toBe(true);
      expect(storedChild!.ancestors.length).toBe(1);
      expect(storedChild!.ancestors[0].toString()).toBe(parentOrg.id);

      // Verify the child response includes ancestors
      expect(childResponse.body.ancestors).toBeDefined();
      expect(childResponse.body.ancestors).toContain(parentOrg.id);

      // Verify GET /orgs/:childId works for OWNER of parent
      const detailResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(detailResponse.status).toBe(200);
      expect(detailResponse.body.id).toBe(childId);
    });

    it('global ADMIN can access any child org', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(childId);
    });

    it('unauthenticated user cannot access child org', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      const response = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}`);

      expect(response.status).toBe(401);
    });

    it('creating sub-org propagates OWNER/ADMIN memberships from parent', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: admin } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });
      await createMembership(admin.id, parentOrg.id, 'ADMIN');
      await createMembership(member.id, parentOrg.id, 'MEMBER');

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      expect(childResponse.status).toBe(201);
      const childId = childResponse.body.id;

      const membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(membersResponse.status).toBe(200);
      const memberIds = membersResponse.body.map((m: any) => m.user.id);
      expect(memberIds).toContain(owner.id);
      expect(memberIds).toContain(admin.id);
      expect(memberIds).not.toContain(member.id);
    });

    it('MEMBER of parent does NOT get propagated to child', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });
      await createMembership(member.id, parentOrg.id, 'MEMBER');

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      const membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      const memberIds = membersResponse.body.map((m: any) => m.user.id);
      expect(memberIds).not.toContain(member.id);
    });

    it('demoting OWNER to MEMBER removes child memberships', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: admin } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });
      await createMembership(admin.id, parentOrg.id, 'ADMIN');

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      let membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(membersResponse.body.map((m: any) => m.user.id)).toContain(admin.id);

      await request(app)
        .put(`${BASE_PATH}/orgs/${parentOrg.id}/members/${admin.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'MEMBER' });

      membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(membersResponse.body.map((m: any) => m.user.id)).not.toContain(admin.id);
    });

    it('promoting MEMBER to ADMIN creates child memberships', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });
      await createMembership(member.id, parentOrg.id, 'MEMBER');

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      let membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(membersResponse.body.map((m: any) => m.user.id)).not.toContain(member.id);

      await request(app)
        .put(`${BASE_PATH}/orgs/${parentOrg.id}/members/${member.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'ADMIN' });

      membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(membersResponse.body.map((m: any) => m.user.id)).toContain(member.id);
    });

    it('removing OWNER/ADMIN from parent removes them from children', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: admin } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });
      await createMembership(admin.id, parentOrg.id, 'ADMIN');

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      let membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(membersResponse.body.map((m: any) => m.user.id)).toContain(admin.id);

      await request(app)
        .delete(`${BASE_PATH}/orgs/${parentOrg.id}/members/${admin.id}`)
        .set('Authorization', `Bearer ${owner.token}`);

      membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(membersResponse.body.map((m: any) => m.user.id)).not.toContain(admin.id);
    });

    it('propagation works across multiple levels of nesting', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: admin } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `grand_${randomSuffix()}` });
      await createMembership(admin.id, parentOrg.id, 'ADMIN');

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      const grandchildResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `grandchild_${randomSuffix()}`,
          displayName: 'Grandchild Org',
          _parentId: childId,
        });
      const grandchildId = grandchildResponse.body.id;

      const membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${grandchildId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      const memberIds = membersResponse.body.map((m: any) => m.user.id);
      expect(memberIds).toContain(owner.id);
      expect(memberIds).toContain(admin.id);
    });

    it('adding OWNER/ADMIN member to parent propagates to existing children', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: newAdmin } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      let membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(membersResponse.body.map((m: any) => m.user.id)).not.toContain(newAdmin.id);

      await request(app)
        .post(`${BASE_PATH}/orgs/${parentOrg.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: newAdmin.id, role: 'ADMIN' });

      membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(membersResponse.body.map((m: any) => m.user.id)).toContain(newAdmin.id);
    });

    it('adding MEMBER to parent does NOT propagate to children', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: newMember } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      await request(app)
        .post(`${BASE_PATH}/orgs/${parentOrg.id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ userId: newMember.id, role: 'MEMBER' });

      const membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(membersResponse.body.map((m: any) => m.user.id)).not.toContain(newMember.id);
    });

    it('promoting to OWNER also propagates to children', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: member } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parent_${randomSuffix()}` });
      await createMembership(member.id, parentOrg.id, 'MEMBER');

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `child_${randomSuffix()}`,
          displayName: 'Child Org',
          _parentId: parentOrg.id,
        });
      const childId = childResponse.body.id;

      await request(app)
        .put(`${BASE_PATH}/orgs/${parentOrg.id}/members/${member.id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ role: 'OWNER' });

      const membersResponse = await request(app)
        .get(`${BASE_PATH}/orgs/${childId}/members`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(membersResponse.body.map((m: any) => m.user.id)).toContain(member.id);
    });

    it('top-level org creation does NOT attempt propagation', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const response = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `top_${randomSuffix()}`,
          displayName: 'Top Org',
        });
      expect(response.status).toBe(201);
      expect(response.body._parentId).toBeFalsy();
    });
  });

  // =========================================================================
  // GET /users/me/orgs — Role Display
  // =========================================================================
  describe('GET /users/me/orgs — Role Display', () => {
    it('returns OWNER role for personal organization', async () => {
      const { user, organizationId } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      const personalOrg = response.body.find((o: any) => o.id === organizationId);
      expect(personalOrg).toBeDefined();
      expect(personalOrg.role).toBe('OWNER');
    });

    it('returns OWNER role for org created by user', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token, { name: `ownerorg_${randomSuffix()}` });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      const found = response.body.find((o: any) => o.id === org.id);
      expect(found).toBeDefined();
      expect(found.role).toBe('OWNER');
    });

    it('returns MEMBER role for org user joined as member', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: joiner } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token, { name: `memberorg_${randomSuffix()}` });
      await createMembership(joiner.id, org.id, 'MEMBER');

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${joiner.token}`);

      expect(response.status).toBe(200);
      const found = response.body.find((o: any) => o.id === org.id);
      expect(found).toBeDefined();
      expect(found.role).toBe('MEMBER');
    });

    it('returns ADMIN role for org user is admin of', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const { user: admin } = await createAndLoginUser('USER');
      const org = await createTestOrganization(owner.token, { name: `adminorg_${randomSuffix()}` });
      await createMembership(admin.id, org.id, 'ADMIN');

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(response.status).toBe(200);
      const found = response.body.find((o: any) => o.id === org.id);
      expect(found).toBeDefined();
      expect(found.role).toBe('ADMIN');
    });

    it('returns inherited OWNER role for child org via parent membership', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `parentrole_${randomSuffix()}` });

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `childrole_${randomSuffix()}`,
          displayName: 'Child Role Org',
          _parentId: parentOrg.id,
        });
      expect(childResponse.status).toBe(201);
      const childId = childResponse.body.id;

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      // Child is nested under parent in tree structure
      const parent = response.body.find((o: any) => o.id === parentOrg.id);
      expect(parent).toBeDefined();
      const child = parent.subOrganizations.find((o: any) => o.id === childId);
      expect(child).toBeDefined();
      expect(child.role).toBe('OWNER');
    });
  });

  // =========================================================================
  // GET /users/me/orgs — Tree Structure
  // =========================================================================
  describe('GET /users/me/orgs — Tree Structure', () => {
    it('nests sub-organizations under their parent', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `treeparent_${randomSuffix()}` });

      const childResponse = await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `treechild_${randomSuffix()}`,
          displayName: 'Tree Child Org',
          _parentId: parentOrg.id,
        });
      expect(childResponse.status).toBe(201);
      const childId = childResponse.body.id;

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      const parent = response.body.find((o: any) => o.id === parentOrg.id);
      expect(parent).toBeDefined();
      expect(Array.isArray(parent.subOrganizations)).toBe(true);
      expect(parent.subOrganizations.length).toBe(1);
      expect(parent.subOrganizations[0].id).toBe(childId);
    });

    it('does not include child orgs as top-level items', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `toplevel_${randomSuffix()}` });

      await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `childonly_${randomSuffix()}`,
          displayName: 'Child Only Org',
          _parentId: parentOrg.id,
        });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      const topLevelIds = response.body.map((o: any) => o.id);
      expect(topLevelIds).toContain(parentOrg.id);
      // Child should NOT appear at top level
      const childAtTop = response.body.find((o: any) => o._parentId === parentOrg.id);
      expect(childAtTop).toBeUndefined();
    });

    it('includes role field in nested sub-organizations', async () => {
      const { user: owner } = await createAndLoginUser('USER');
      const parentOrg = await createTestOrganization(owner.token, { name: `rolechild_${randomSuffix()}` });

      await request(app)
        .post(`${BASE_PATH}/orgs`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          name: `rolechildsub_${randomSuffix()}`,
          displayName: 'Role Child Sub',
          _parentId: parentOrg.id,
        });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      const parent = response.body.find((o: any) => o.id === parentOrg.id);
      expect(parent.subOrganizations[0].role).toBeDefined();
      expect(['OWNER', 'ADMIN', 'MEMBER']).toContain(parent.subOrganizations[0].role);
    });
  });

  // =========================================================================
  // GET /users/me/orgs — Pagination
  // =========================================================================
  describe('GET /users/me/orgs — Pagination', () => {
    it('returns paginated response with items and total when limit is provided', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      // Create 3 additional orgs
      await createTestOrganization(owner.token, { name: `pag1_${randomSuffix()}` });
      await createTestOrganization(owner.token, { name: `pag2_${randomSuffix()}` });
      await createTestOrganization(owner.token, { name: `pag3_${randomSuffix()}` });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs?limit=2`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body).not.toBeInstanceOf(Array);
      expect(response.body.items).toBeDefined();
      expect(response.body.total).toBeDefined();
      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.items.length).toBeLessThanOrEqual(2);
      expect(response.body.total).toBeGreaterThanOrEqual(4); // personal + 3 created
    });

    it('returns correct page with offset', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      const org1 = await createTestOrganization(owner.token, { name: `offset1_${randomSuffix()}` });
      const org2 = await createTestOrganization(owner.token, { name: `offset2_${randomSuffix()}` });

      const page1 = await request(app)
        .get(`${BASE_PATH}/users/me/orgs?limit=1&offset=0`)
        .set('Authorization', `Bearer ${owner.token}`);

      const page2 = await request(app)
        .get(`${BASE_PATH}/users/me/orgs?limit=1&offset=1`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);
      expect(page1.body.items.length).toBe(1);
      expect(page2.body.items.length).toBe(1);
      // Different items on different pages
      expect(page1.body.items[0].id).not.toBe(page2.body.items[0].id);
    });

    it('returns empty items when offset exceeds total', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs?limit=10&offset=1000`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBeGreaterThanOrEqual(1);
    });

    it('returns plain array when no pagination params are provided', async () => {
      const { user } = await createAndLoginUser('USER');

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('total count reflects all top-level orgs including personal', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      await createTestOrganization(owner.token, { name: `total1_${randomSuffix()}` });

      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs?limit=1`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.total).toBeGreaterThanOrEqual(2); // personal + at least 1 created
    });

    it('paginates top-level orgs, not memberships — sub-orgs do not reduce page count', async () => {
      const { user: owner } = await createAndLoginUser('USER');

      // Create parent with 2 children (3 memberships, but only 1 top-level)
      const parent = await createTestOrganization(owner.token, { name: `ppag_${randomSuffix()}` });
      await createTestOrganization(owner.token, { name: `ppagchild1_${randomSuffix()}`, _parentId: parent.id });
      await createTestOrganization(owner.token, { name: `ppagchild2_${randomSuffix()}`, _parentId: parent.id });

      // Create 2 more top-level orgs
      await createTestOrganization(owner.token, { name: `tpag1_${randomSuffix()}` });
      await createTestOrganization(owner.token, { name: `tpag2_${randomSuffix()}` });

      // Total top-level: 1 personal + 1 parent + 2 top-level = 4
      const response = await request(app)
        .get(`${BASE_PATH}/users/me/orgs?limit=3`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(response.status).toBe(200);
      expect(response.body.items).toBeDefined();
      expect(response.body.items.length).toBe(3);
      expect(response.body.total).toBe(4);

      // The parent must appear with its 2 children nested
      const parentInResponse = response.body.items.find((o: any) => o.id === parent.id);
      expect(parentInResponse).toBeDefined();
      expect(parentInResponse.subOrganizations.length).toBe(2);
    });
  });
});
