import dotenv from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { shutdownApp, TestApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { createAndLoginUser } from './utils/users/userTestUtils';
import { createTestOrganization, createMembership } from './utils/organizations';
import { createPricingForOrganization } from './utils/pricings/pricingTestUtils';
import { createTestCollection } from './utils/collections/collectionTestUtils';
import Pricing from '../main/repositories/mongoose/models/PricingMongoose';
import Identity from '../main/repositories/mongoose/models/PricingIdentityMongoose';
import Organization from '../main/repositories/mongoose/models/OrganizationMongoose';
import { createEntityScopedPermission } from './utils/organizations/organizationTestUtils';
import { up as migrateVisibility } from '../main/migrations/mongo/20261120120000-organization-visibility';
import mongoose from 'mongoose';
import Notification from '../main/repositories/mongoose/models/NotificationMongoose';

dotenv.config();

describe('Organization visibility and parent permissions', () => {
  let app: TestApp;
  beforeAll(() => { app = testContainer.resolve('app'); });
  afterAll(async () => {
    for (const file of testContainer.resolve<Set<string>>('generatedFilesToDelete')) await fs.rm(file, { force: true, recursive: true });
    await shutdownApp();
  });

  it('enforces public, unlisted and private on discovery, pages, files and parent collections', async () => {
    const { user: owner } = await createAndLoginUser('USER');
    const { user: member } = await createAndLoginUser('USER');
    const { user: outsider } = await createAndLoginUser('USER');
    const org = await createTestOrganization(owner.token, { displayName: `Visibility ${Date.now()}` });
    const child = await createTestOrganization(owner.token, { displayName: `Hidden child ${Date.now()}`, _parentId: org.id });
    expect((await request(app).put(`${BASE_PATH}/orgs/${child.id}`).set('Authorization', `Bearer ${owner.token}`).send({ visibility: 'private' })).status).toBe(200);
    await Organization.collection.updateOne({ _id: new mongoose.Types.ObjectId(org.id) }, { $unset: { visibility: '' } });
    await migrateVisibility(mongoose.connection);
    await migrateVisibility(mongoose.connection);
    expect((await Organization.collection.findOne({ _id: new mongoose.Types.ObjectId(org.id) }))?.visibility).toBe('public');
    await createMembership(member.id, org.id, 'MEMBER');
    const created = await createPricingForOrganization({ organizationId: org.id, serviceName: `vis-${Date.now()}` });
    const version: any = await Pricing.findById(created.id).lean();
    const collection = await createTestCollection({ _organizationId: org.id, private: false });
    await Pricing.updateOne({ _id: version._id }, { $set: { _collectionId: collection.id } });
    await Identity.updateOne({ _id: version.pricingId }, { $set: { _collectionId: collection.id } });
    testContainer.resolve<Set<string>>('generatedFilesToDelete').add(path.resolve(process.cwd(), 'public', version.yaml));
    const uploadedAvatar = await request(app).post(`${BASE_PATH}/orgs/${org.id}/avatar`)
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('avatar', Buffer.from('test image'), { filename: 'avatar.png', contentType: 'image/png' });
    expect(uploadedAvatar.status).toBe(200);
    const avatarPath = new URL(uploadedAvatar.body.avatar).pathname;
    testContainer.resolve<Set<string>>('generatedFilesToDelete').add(path.resolve(process.cwd(), 'public', avatarPath.slice(1)));

    const get = (url: string, token?: string) => {
      const req = request(app).get(url);
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };
    const setVisibility = (visibility: string, token = owner.token) => request(app)
      .put(`${BASE_PATH}/orgs/${org.id}`).set('Authorization', `Bearer ${token}`).send({ visibility });
    const orgPath = `${BASE_PATH}/orgs/${org.id}`;
    const pricingPath = `${BASE_PATH}/pricings/${org.id}/${created.serviceName}`;
    const collectionPath = `${BASE_PATH}/collections/${org.id}/${collection.slug}`;
    const manifest = `${BASE_PATH}/public/pricings/${version.pricingId}`;
    const filePath = `/${version.yaml.replace(/^\//, '')}`;
    const discovery = async () => (await get(`${BASE_PATH}/orgs/public?q=${encodeURIComponent(org.displayName)}`)).body.items;
    const pricingDiscovery = async () => (await get(`${BASE_PATH}/pricings`)).body.pricings ?? [];
    await Notification.create({ _userId: outsider.id, kind: 'PricingUpdated', title: created.serviceName,
      message: created.serviceName, data: { organizationId: org.id, pricingSlug: created.serviceName, version: version.version } });
    expect(JSON.stringify((await get(`${BASE_PATH}/notifications`, outsider.token)).body)).toContain(created.serviceName);

    expect((await discovery()).some((item: any) => item.id === org.id)).toBe(true);
    expect(JSON.stringify((await get(orgPath)).body)).not.toContain(child.displayName);
    expect(JSON.stringify((await get(`${orgPath}/hierarchy`)).body)).not.toContain(child.displayName);
    expect(JSON.stringify((await get(`${orgPath}/hierarchy`, owner.token)).body)).toContain(child.displayName);
    const other = await createTestOrganization(owner.token, { displayName: `Other ${Date.now()}` });
    const key = await request(app).post(`${BASE_PATH}/users/${owner.username}/api-keys`)
      .set('Authorization', `Bearer ${owner.token}`).send({ name: 'restricted', scopes: [{ organizationId: other.id, scope: 'VIEW' }] });
    expect(key.status).toBe(201);
    const hierarchyWithKey = await request(app).get(`${orgPath}/hierarchy`).set('x-api-key', key.body.plainKey);
    expect(JSON.stringify(hierarchyWithKey.body)).not.toContain(child.displayName);
    expect((await get(pricingPath)).status).toBe(200);
    expect((await get(avatarPath)).status).toBe(200);
    expect((await setVisibility('unlisted')).status).toBe(200);
    await migrateVisibility(mongoose.connection);
    expect((await Organization.collection.findOne({ _id: new mongoose.Types.ObjectId(org.id) }))?.visibility).toBe('unlisted');
    expect((await discovery()).some((item: any) => item.id === org.id)).toBe(false);
    expect((await pricingDiscovery()).some((item: any) => item.slug === created.serviceName)).toBe(false);
    expect((await get(orgPath)).status).toBe(200);
    expect((await get(pricingPath)).status).toBe(200);
    expect((await get(manifest)).status).toBe(200);
    await request(app).put(`${BASE_PATH}/users/me/settings/beta-features`).set('Authorization', `Bearer ${outsider.token}`).send({ enabled: true });
    await request(app).put(`${BASE_PATH}/users/me/settings/beta-features`).set('Authorization', `Bearer ${member.token}`).send({ enabled: true });
    await request(app).put(orgPath).set('Authorization', `Bearer ${owner.token}`).send({ servicesPublic: true });
    expect((await get(`${orgPath}/services`, outsider.token)).status).toBe(200);

    expect((await setVisibility('private', outsider.token)).status).toBe(403);
    expect((await setVisibility('private')).status).toBe(200);
    const encodedId = `%${org.id.charCodeAt(0).toString(16)}${org.id.slice(1)}`;
    expect((await get(`${BASE_PATH}/orgs/${encodedId}/members`)).status).toBe(404);
    expect((await get(`${BASE_PATH}/orgs/${encodedId}/hierarchy`)).status).toBe(404);
    expect((await get(`${orgPath}/services`, outsider.token)).status).toBe(404);
    expect((await get(`${orgPath}/services`, member.token)).status).toBe(200);
    expect(JSON.stringify((await get(`${BASE_PATH}/notifications`, outsider.token)).body)).not.toContain(created.serviceName);
    for (const url of [orgPath, `${orgPath}/members`, `${orgPath}/hierarchy`, pricingPath, collectionPath, manifest]) {
      expect((await get(url)).status, url).toBe(404);
      expect((await get(url, outsider.token)).status, url).toBe(404);
    }
    expect([403, 404]).toContain((await get(filePath)).status);
    expect([403, 404]).toContain((await get(avatarPath)).status);
    expect((await get(avatarPath, owner.token)).status).toBe(200);
    expect([403, 404]).toContain((await get(filePath, outsider.token)).status);
    for (const url of [orgPath, pricingPath, collectionPath, manifest, filePath]) {
      expect((await get(url, owner.token)).status, url).toBe(200);
    }
    expect((await get(pricingPath, member.token)).status).toBe(200);

    await request(app).put(collectionPath).set('Authorization', `Bearer ${owner.token}`).send({ private: true });
    await createEntityScopedPermission(member.id, org.id, created.serviceName, 'pricing', { GET: true, PUT: false, DELETE: false, CREATE: false });
    expect((await get(pricingPath, member.token)).status).toBe(404);
    expect((await get(`${pricingPath}/${version.version}`, member.token)).status).toBe(404);
    expect((await get(manifest, member.token)).status).toBe(404);
    expect([403, 404]).toContain((await get(filePath, member.token)).status);
    expect((await get(pricingPath, owner.token)).status).toBe(200);
    await createEntityScopedPermission(member.id, org.id, collection.slug, 'collection', { GET: true, PUT: false, DELETE: false, CREATE: false });
    expect((await get(pricingPath, member.token)).status).toBe(200);
  }, 60000);
});
