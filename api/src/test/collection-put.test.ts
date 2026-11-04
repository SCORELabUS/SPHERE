import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { shutdownApp, TestApp } from './utils/testApp';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import { createTestOrganization, createMembership, cleanupOrganization, createOrgScopedPermission } from './utils/organizations';
import { createTestCollection } from './utils/collections/collectionTestUtils';
import { createPricingForOrganization } from './utils/pricings/pricingTestUtils';
import { randomSuffix } from './utils/helpers';
import PricingIdentityMongoose from '../main/repositories/mongoose/models/PricingIdentityMongoose';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import EntityPermissionMongoose from '../main/repositories/mongoose/models/EntityPermissionMongoose';
import { PricingStepBuilder } from '../main/services/orbit/orbitPricingSteps';

const none = { GET: false, PUT: false, DELETE: false, CREATE: false };

describe('Collection PUT authority and independent membership permissions', { timeout: 60000 }, () => {
  let app: TestApp;
  const orgs = new Set<string>();
  beforeAll(() => { app = testContainer.resolve('app'); });
  afterEach(async () => {
    for (const id of orgs) {
      await PricingMongoose.deleteMany({ _organizationId: new mongoose.Types.ObjectId(id) });
      await PricingCollectionMongoose.deleteMany({ _organizationId: new mongoose.Types.ObjectId(id) });
    }
    orgs.clear();
    const users = testContainer.resolve<Set<string>>('usersToDelete');
    for (const username of users) await deleteTestUser(username);
    users.clear();
    const organizations = testContainer.resolve<Set<string>>('orgsToDelete');
    for (const id of organizations) await cleanupOrganization(id);
    organizations.clear();
    const files = testContainer.resolve<Set<string>>('generatedFilesToDelete');
    for (const file of files) await fs.rm(file, { force: true, recursive: true });
    files.clear();
    testContainer.resolve<Set<string>>('collectionIdsToDelete').clear();
  });
  afterAll(shutdownApp);

  async function setup(inside = true, privateVersion = false) {
    const { user: owner } = await createAndLoginUser('USER');
    const organization = await createTestOrganization(owner.token, { displayName: `PUT ${randomSuffix()}` });
    orgs.add(organization.id);
    const { user: member } = await createAndLoginUser('USER');
    await createMembership(member.id, organization.id, 'MEMBER');
    const collection = await createTestCollection({ _organizationId: organization.id, name: `col-${randomSuffix()}`, private: true });
    const pricing = await createPricingForOrganization({ organizationId: organization.id, serviceName: `price-${randomSuffix()}`, isPrivate: privateVersion });
    const slug = pricing.response.body.slug as string;
    const url = `${BASE_PATH}/pricings/${organization.id}/${slug}`;
    const membership = `${BASE_PATH}/collections/${organization.id}/${collection.slug}`;
    if (inside) await request(app).post(membership).auth(owner.token, { type: 'bearer' }).send({ pricingSlug: slug }).expect(200);
    const grant = async (type: 'pricing' | 'collection', target: string, permissions: Partial<typeof none>) => {
      await EntityPermissionMongoose.updateOne({ _userId: member.id, _organizationId: organization.id, entityType: type, entitySlug: target },
        { $set: { permissions: { ...none, ...permissions } } }, { upsert: true });
    };
    const edit = (query = '') => request(app).put(url + query).auth(member.token, { type: 'bearer' }).send({ url: 'https://example.com/edited' });
    const location = async () => (await PricingMongoose.findOne({ slug, _organizationId: organization.id }).lean())?._collectionId;
    return { owner, member, organization, collection, pricing, slug, url, membership, grant, edit, location };
  }

  it('edits a private pricing and its visibility with collection PUT only; reports that PUT to the UI', async () => {
    const f = await setup(true, true);
    await f.grant('collection', f.collection.slug, { GET: true, PUT: true });
    const permissions = await request(app).get(f.url + '/permissions').auth(f.member.token, { type: 'bearer' }).expect(200);
    expect(permissions.body.PUT).toBe(true);
    await f.edit().expect(200);
    await request(app).put(`${f.url}/${f.pricing.version}`).auth(f.member.token, { type: 'bearer' }).send({ private: false }).expect(200);
  });

  it('denies individual PUT when the stored collection denies PUT', async () => {
    const f = await setup();
    await f.grant('collection', f.collection.slug, { GET: true });
    await f.grant('pricing', f.slug, { GET: true, PUT: true });
    await f.edit().expect(403);
    const permissions = await request(app).get(f.url + '/permissions').auth(f.member.token, { type: 'bearer' }).expect(200);
    expect(permissions.body.PUT).toBe(false);
  });

  it('uses the selected family when two collections contain the same slug', async () => {
    const f = await setup();
    const other = await createTestCollection({ _organizationId: f.organization.id, name: `same-${randomSuffix()}` });
    const original = await PricingMongoose.findOne({ slug: f.slug, _organizationId: f.organization.id }).lean();
    const identity = await PricingIdentityMongoose.create({ name: original!.name, slug: f.slug, _organizationId: f.organization.id, _collectionId: other.id });
    await PricingMongoose.create({ ...original, _id: undefined, __v: undefined, pricingId: identity._id, _collectionId: other.id });
    await f.grant('pricing', f.slug, { GET: true, PUT: true });
    await f.grant('collection', f.collection.slug, { GET: true });
    await f.grant('collection', other.slug, { GET: true, PUT: true });
    await f.edit(`?collection=${f.collection.slug}`).expect(403);
    const updated = await f.edit(`?collection=${other.slug}`).expect(200);
    expect(updated.body.pricingId).toBe(String(identity._id));
    await request(app).put(`${f.url}/${f.pricing.version}?collection=${other.slug}`).auth(f.member.token, { type: 'bearer' }).send({ private: true }).expect(200);
    expect((await PricingMongoose.findById(original!._id).lean())!.private).toBe(false);
    expect((await PricingMongoose.findOne({ pricingId: identity._id }).lean())!.private).toBe(true);
    for (const [collection, allowed] of [[f.collection.slug, false], [other.slug, true]] as const) {
      const response = await request(app).get(`${f.url}/permissions?collection=${collection}`).auth(f.member.token, { type: 'bearer' }).expect(200);
      expect(response.body.PUT).toBe(allowed);
    }
    expect((await PricingMongoose.findById(original!._id).lean())!.url).toBe(original!.url);
    expect((await PricingMongoose.findOne({ pricingId: identity._id }).lean())!.url).toBe('https://example.com/edited');
  });

  it('keeps individual PUT outside collections', async () => {
    const f = await setup(false);
    await f.grant('pricing', f.slug, { GET: true, PUT: true });
    await f.edit().expect(200);
  });

  it('requires both PUTs to add an existing pricing', async () => {
    const f = await setup(false);
    await f.grant('collection', f.collection.slug, { GET: true, PUT: true });
    await request(app).post(f.membership).auth(f.member.token, { type: 'bearer' }).send({ pricingSlug: f.slug }).expect(403);
    expect(await f.location()).toBeFalsy();
    await f.grant('pricing', f.slug, { GET: true, PUT: true });
    await request(app).post(f.membership).auth(f.member.token, { type: 'bearer' }).send({ pricingSlug: f.slug }).expect(200);
    expect(String(await f.location())).toBe(f.collection.id);
  });

  it('requires independent pricing PUT to remove, and collection PUT suffices without collection DELETE', async () => {
    const f = await setup();
    await f.grant('collection', f.collection.slug, { GET: true, PUT: true });
    const remove = () => request(app).delete(`${f.membership}/pricings/${f.slug}`).auth(f.member.token, { type: 'bearer' });
    await remove().expect(403);
    expect(String(await f.location())).toBe(f.collection.id);
    await f.grant('pricing', f.slug, { GET: true, PUT: true });
    await remove().expect(200);
    expect(await f.location()).toBeFalsy();
  });

  it('requires PUT on both source and destination when moving between collections', async () => {
    const f = await setup();
    const target = await createTestCollection({ _organizationId: f.organization.id, name: `target-${randomSuffix()}` });
    await f.grant('pricing', f.slug, { GET: true, PUT: true });
    await f.grant('collection', f.collection.slug, { GET: true });
    await f.grant('collection', target.slug, { GET: true, PUT: true });
    const add = () => request(app).post(`${BASE_PATH}/collections/${f.organization.id}/${target.slug}`).auth(f.member.token, { type: 'bearer' }).send({ pricingSlug: f.slug });
    await add().expect(403);
    expect(String(await f.location())).toBe(f.collection.id);
    await f.grant('collection', f.collection.slug, { GET: true, PUT: true });
    await add().expect(200);
    expect(String(await f.location())).toBe(target.id);
  });

  it('does not accept PUT from an unrelated collection named in the query', async () => {
    const f = await setup();
    const other = await createTestCollection({ _organizationId: f.organization.id, name: `other-${randomSuffix()}` });
    await f.grant('pricing', f.slug, { GET: true, PUT: true });
    await f.grant('collection', f.collection.slug, { GET: true });
    await f.grant('collection', other.slug, { GET: true, PUT: true });
    await f.edit(`?collection=${other.slug}`).expect(404);
  });

  it('applies the same independent PUT rule when creating a collection with existing pricings', async () => {
    const f = await setup(false);
    await createOrgScopedPermission(f.member.id, f.organization.id, 'collection', { ...none, CREATE: true });
    const create = () => request(app).post(`${BASE_PATH}/collections/${f.organization.id}`).auth(f.member.token, { type: 'bearer' })
      .send({ name: `new-${randomSuffix()}`, pricings: [f.slug] });
    await create().expect(403);
    await f.grant('pricing', f.slug, { GET: true, PUT: true });
    await create().expect(201);
  });

  it('keeps VIEW credentials read-only and permits a scoped MANAGEMENT key with collection PUT', async () => {
    const f = await setup();
    await f.grant('collection', f.collection.slug, { GET: true, PUT: true });
    for (const scope of ['VIEW', 'MANAGEMENT']) {
      const key = await request(app).post(`${BASE_PATH}/users/${f.member.username}/api-keys`).auth(f.member.token, { type: 'bearer' })
        .send({ name: scope, scopes: [{ organizationId: f.organization.id, scope }] }).expect(201);
      await request(app).put(f.url).set('x-api-key', key.body.plainKey).send({ url: 'https://example.com/scoped' }).expect(scope === 'VIEW' ? 403 : 200);
    }
  });

  it('uses the same edit and move rules when validating ORBIT plans', async () => {
    const f = await setup();
    await f.grant('collection', f.collection.slug, { GET: true, PUT: true });
    const builder = new PricingStepBuilder({ actor: { id: f.member.id, username: f.member.username, role: 'USER' },
      roleIn: async () => 'MEMBER', findOrganization: async () => ({ id: f.organization.id, displayName: 'PUT Org' }) } as any, []);
    expect(await builder.allowed(f.organization.id, 'pricing', 'PUT', f.slug, false)).toBe(true);
    const errors: string[] = [];
    await builder.collectionChanges([{ organizationId: f.organization.id, collection: f.collection.slug, remove: [f.slug] }], errors, []);
    expect(errors.length).toBeGreaterThan(0);
    expect(String(await f.location())).toBe(f.collection.id);
  });
});
