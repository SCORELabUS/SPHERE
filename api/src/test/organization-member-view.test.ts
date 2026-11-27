import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { randomSuffix } from './utils/helpers';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import { createPricingForOrganization } from './utils/pricings/pricingTestUtils';
import { createTestCollection } from './utils/collections/collectionTestUtils';
import { createMembership } from './utils/organizations';
import { createEntityScopedPermission } from './utils/organizations/organizationTestUtils';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import OrganizationMembershipMongoose from '../main/repositories/mongoose/models/OrganizationMembershipMongoose';
import EntityPermissionMongoose from '../main/repositories/mongoose/models/EntityPermissionMongoose';
import ServiceTreeMongoose from '../main/repositories/mongoose/models/ServiceTreeMongoose';

dotenv.config();

const NONE = { GET: false, PUT: false, DELETE: false, CREATE: false };

describe('Organization read as one of its members', () => {
  let app: TestApp;
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const pricingsToDelete: Set<string> = testContainer.resolve('pricingsToDelete');
  const generatedFilesToDelete: Set<string> = testContainer.resolve('generatedFilesToDelete');
  const membershipsToDelete: Set<string> = testContainer.resolve('membershipsToDelete');
  const collectionIdsToDelete: Set<string> = testContainer.resolve('collectionIdsToDelete');
  const organizationsTouched = new Set<string>();

  beforeAll(async () => {
    app = testContainer.resolve('app');
  });

  afterEach(async () => {
    for (const username of usersToDelete) await deleteTestUser(username);
    usersToDelete.clear();
    for (const pricingId of pricingsToDelete) await PricingMongoose.deleteOne({ _id: pricingId });
    pricingsToDelete.clear();
    for (const filePath of generatedFilesToDelete) await fs.rm(filePath, { force: true });
    generatedFilesToDelete.clear();
    for (const membershipId of membershipsToDelete) await OrganizationMembershipMongoose.deleteOne({ _id: membershipId });
    membershipsToDelete.clear();
    for (const collectionId of collectionIdsToDelete) await PricingCollectionMongoose.deleteOne({ _id: collectionId });
    collectionIdsToDelete.clear();
    for (const organizationId of organizationsTouched) {
      await EntityPermissionMongoose.deleteMany({ _organizationId: organizationId });
      await ServiceTreeMongoose.deleteOne({ _organizationId: organizationId });
    }
    organizationsTouched.clear();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  const viewPath = (organizationId: string, userId: string, part: string) =>
    `${BASE_PATH}/orgs/${organizationId}/member-views/${userId}/${part}`;

  const get = (url: string, auth?: { token?: string; key?: string }) => {
    const call = request(app).get(url);
    if (auth?.token) call.set('Authorization', `Bearer ${auth.token}`);
    if (auth?.key) call.set('x-api-key', auth.key);
    return call;
  };

  const enableBeta = (token: string) =>
    request(app)
      .put(`${BASE_PATH}/users/me/settings/beta-features`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true });

  const names = (body: any, key: 'pricings' | 'collections') => (body[key] ?? []).map((item: any) => item.name).sort();

  /**
   * An organization with a public pricing, a private one nobody was given and a
   * private one its plain member may read, plus that member, an admin and someone
   * from outside.
   */
  async function setup() {
    const { user: owner, organizationId } = await createAndLoginUser('USER');
    organizationsTouched.add(organizationId);
    const { user: member } = await createAndLoginUser('USER');
    const { user: admin } = await createAndLoginUser('USER');
    const { user: outsider } = await createAndLoginUser('USER');
    await createMembership(member.id, organizationId, 'MEMBER');
    await createMembership(admin.id, organizationId, 'ADMIN');

    const suffix = randomSuffix().toLowerCase();
    const open = await createPricingForOrganization({ organizationId, serviceName: `open-${suffix}` });
    const hidden = await createPricingForOrganization({ organizationId, serviceName: `hidden-${suffix}`, isPrivate: true });
    const granted = await createPricingForOrganization({ organizationId, serviceName: `granted-${suffix}`, isPrivate: true });
    await createEntityScopedPermission(member.id, organizationId, granted.serviceName, 'pricing', { ...NONE, GET: true });

    return { owner, member, admin, outsider, organizationId, open, hidden, granted };
  }

  it('lists to the owner the pricings the member gets, the same the member lists', async () => {
    const { owner, member, organizationId, open, hidden, granted } = await setup();

    const asMember = await get(viewPath(organizationId, member.id, 'pricings'), { token: owner.token });
    const memberOwn = await get(`${BASE_PATH}/pricings/${organizationId}`, { token: member.token });
    const ownerOwn = await get(`${BASE_PATH}/pricings/${organizationId}`, { token: owner.token });

    expect(asMember.status).toBe(200);
    expect(asMember.headers['cache-control']).toBe('no-store');
    expect(names(asMember.body, 'pricings')).toEqual([granted.serviceName, open.serviceName].sort());
    expect(names(asMember.body, 'pricings')).toEqual(names(memberOwn.body, 'pricings'));
    expect(asMember.body.total).toBe(memberOwn.body.total);
    expect(names(ownerOwn.body, 'pricings')).toContain(hidden.serviceName);
  });

  it('respects unlisted pricing permissions in member previews', async () => {
    const { owner, member, organizationId } = await setup();
    const suffix = randomSuffix().toLowerCase();
    const unlisted = await createPricingForOrganization({ organizationId, serviceName: `unlisted-${suffix}` });
    await PricingMongoose.updateOne({ _id: unlisted.id }, { $set: { unlisted: true } });

    const preview = () => get(viewPath(organizationId, member.id, 'pricings'), { token: owner.token });
    const plain = await get(viewPath(organizationId, 'any', 'pricings'), { token: owner.token });
    expect(plain.status).toBe(200);
    expect(names(plain.body, 'pricings')).not.toContain(unlisted.serviceName);
    const before = await preview();
    expect(before.status).toBe(200);
    expect(names(before.body, 'pricings')).not.toContain(unlisted.serviceName);

    await createEntityScopedPermission(member.id, organizationId, unlisted.serviceName, 'pricing', { ...NONE, GET: true });
    const after = await preview();
    const memberOwn = await get(`${BASE_PATH}/pricings/${organizationId}`, { token: member.token });
    expect(after.status).toBe(200);
    expect(memberOwn.status).toBe(200);
    expect(names(after.body, 'pricings')).toEqual(names(memberOwn.body, 'pricings'));
    expect(names(after.body, 'pricings')).toContain(unlisted.serviceName);
    const plainAfter = await get(viewPath(organizationId, 'any', 'pricings'), { token: owner.token });
    expect(names(plainAfter.body, 'pricings')).not.toContain(unlisted.serviceName);
  });

  it('applies the listing filters to the pricings the member gets', async () => {
    const { owner, member, organizationId, granted } = await setup();

    const filtered = await get(`${viewPath(organizationId, member.id, 'pricings')}?name=granted&limit=5`, { token: owner.token });

    expect(filtered.status).toBe(200);
    expect(names(filtered.body, 'pricings')).toEqual([granted.serviceName]);
  });

  it('lists the collections the member gets, the same the member lists', async () => {
    const { owner, member, organizationId } = await setup();
    const suffix = randomSuffix().toLowerCase();
    const open = await createTestCollection({ _organizationId: organizationId, name: `open-col-${suffix}` });
    const hidden = await createTestCollection({ _organizationId: organizationId, name: `hidden-col-${suffix}`, private: true });
    const granted = await createTestCollection({ _organizationId: organizationId, name: `granted-col-${suffix}`, private: true });
    await createEntityScopedPermission(member.id, organizationId, granted.slug, 'collection', { ...NONE, GET: true });

    const asMember = await get(viewPath(organizationId, member.id, 'collections'), { token: owner.token });
    const memberOwn = await get(`${BASE_PATH}/collections/${organizationId}`, { token: member.token });

    expect(asMember.status).toBe(200);
    expect(names(asMember.body, 'collections')).toEqual([granted.name, open.name].sort());
    expect(names(asMember.body, 'collections')).not.toContain(hidden.name);
    expect(names(asMember.body, 'collections')).toEqual(names(memberOwn.body, 'collections'));
  });

  it('marks the hierarchy as it is for the member', async () => {
    const { owner, member, outsider, organizationId } = await setup();

    const asMember = await get(viewPath(organizationId, member.id, 'hierarchy'), { token: owner.token });
    const memberOwn = await get(`${BASE_PATH}/orgs/${organizationId}/hierarchy`, { token: member.token });
    const outsiderOwn = await get(`${BASE_PATH}/orgs/${organizationId}/hierarchy`, { token: outsider.token });

    expect(asMember.status).toBe(200);
    expect(asMember.body).toEqual(memberOwn.body);
    expect(asMember.body.find((node: any) => node.id === organizationId).hasAccess).toBe(true);
    expect(outsiderOwn.body.find((node: any) => node.id === organizationId).hasAccess).toBe(false);
  });

  it('shows the services as the member reads them, never editable', async () => {
    const { owner, member, organizationId, open, hidden } = await setup();
    await enableBeta(owner.token);
    const pricingIdOf = async (id: string) => String(((await PricingMongoose.findById(id).lean()) as any).pricingId);
    const openId = await pricingIdOf(open.id);
    const hiddenId = await pricingIdOf(hidden.id);
    const saved = await request(app)
      .put(`${BASE_PATH}/orgs/${organizationId}/services`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ revision: 0, nodes: [{ id: 'a', parentId: null, name: 'Service', pricingIds: [openId, hiddenId] }] });
    expect(saved.status).toBe(200);

    const asMember = await get(viewPath(organizationId, member.id, 'services'), { token: owner.token });

    expect(asMember.status).toBe(200);
    expect(asMember.body.canEdit).toBe(false);
    expect(asMember.body.nodes).toHaveLength(1);
    expect(Object.keys(asMember.body.pricings)).toEqual([openId]);
    expect(JSON.stringify(asMember.body)).not.toContain(hidden.serviceName);
  });

  it('keeps the services behind the beta features of whoever is looking', async () => {
    const { owner, member, organizationId } = await setup();

    const response = await get(viewPath(organizationId, member.id, 'services'), { token: owner.token });

    expect(response.status).toBe(403);
  });

  it('lets an admin read the organization as a member too', async () => {
    const { admin, member, organizationId } = await setup();

    const response = await get(viewPath(organizationId, member.id, 'pricings'), { token: admin.token });

    expect(response.status).toBe(200);
  });

  it('is only for owners and admins', async () => {
    const { owner, member, outsider, organizationId } = await setup();
    const { user: otherMember } = await createAndLoginUser('USER');
    await createMembership(otherMember.id, organizationId, 'MEMBER');

    for (const part of ['pricings', 'collections', 'hierarchy']) {
      const path = viewPath(organizationId, member.id, part);
      expect((await get(path)).status, `${part} anonymous`).toBe(401);
      expect((await get(path, { token: outsider.token })).status, `${part} outsider`).toBe(403);
      expect((await get(path, { token: otherMember.token })).status, `${part} member`).toBe(403);
      expect((await get(viewPath(organizationId, owner.id, part), { token: member.token })).status, `${part} member on owner`).toBe(403);
    }
  });

  it('only looks at members of the organization', async () => {
    const { owner, outsider, organizationId } = await setup();

    const notMember = await get(viewPath(organizationId, outsider.id, 'pricings'), { token: owner.token });
    const notAnId = await get(viewPath(organizationId, 'not-an-id', 'pricings'), { token: owner.token });

    expect(notMember.status).toBe(404);
    expect(notAnId.status).toBe(404);
  });

  describe('as any plain member', () => {
    it('lists only what a member with no permission of their own gets, the same such a member lists', async () => {
      const { owner, organizationId, open } = await setup();
      const suffix = randomSuffix().toLowerCase();
      const openCollection = await createTestCollection({ _organizationId: organizationId, name: `open-col-${suffix}` });
      await createTestCollection({ _organizationId: organizationId, name: `hidden-col-${suffix}`, private: true });
      const { user: plain } = await createAndLoginUser('USER');
      await createMembership(plain.id, organizationId, 'MEMBER');

      const pricings = await get(viewPath(organizationId, 'any', 'pricings'), { token: owner.token });
      const collections = await get(viewPath(organizationId, 'any', 'collections'), { token: owner.token });
      const hierarchy = await get(viewPath(organizationId, 'any', 'hierarchy'), { token: owner.token });
      const plainPricings = await get(`${BASE_PATH}/pricings/${organizationId}`, { token: plain.token });
      const plainCollections = await get(`${BASE_PATH}/collections/${organizationId}`, { token: plain.token });
      const plainHierarchy = await get(`${BASE_PATH}/orgs/${organizationId}/hierarchy`, { token: plain.token });

      expect(pricings.status).toBe(200);
      expect(pricings.headers['cache-control']).toBe('no-store');
      expect(names(pricings.body, 'pricings')).toEqual([open.serviceName]);
      expect(names(pricings.body, 'pricings')).toEqual(names(plainPricings.body, 'pricings'));
      expect(names(collections.body, 'collections')).toEqual([openCollection.name]);
      expect(names(collections.body, 'collections')).toEqual(names(plainCollections.body, 'collections'));
      expect(hierarchy.body).toEqual(plainHierarchy.body);
      expect(hierarchy.body.find((node: any) => node.id === organizationId).hasAccess).toBe(true);
    });

    it('shows the services with only the pricings any member may list', async () => {
      const { owner, organizationId, open, hidden, granted } = await setup();
      await enableBeta(owner.token);
      const pricingIdOf = async (id: string) => String(((await PricingMongoose.findById(id).lean()) as any).pricingId);
      const ids = await Promise.all([open.id, hidden.id, granted.id].map(pricingIdOf));
      const saved = await request(app)
        .put(`${BASE_PATH}/orgs/${organizationId}/services`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ revision: 0, nodes: [{ id: 'a', parentId: null, name: 'Service', pricingIds: ids }] });
      expect(saved.status).toBe(200);

      const response = await get(viewPath(organizationId, 'any', 'services'), { token: owner.token });

      expect(response.status).toBe(200);
      expect(response.body.canEdit).toBe(false);
      expect(Object.keys(response.body.pricings)).toEqual([ids[0]]);
      expect(JSON.stringify(response.body)).not.toContain(granted.serviceName);
    });

    it('needs no member to exist in the organization', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      organizationsTouched.add(organizationId);
      const open = await createPricingForOrganization({ organizationId, serviceName: `alone-${randomSuffix().toLowerCase()}` });

      const response = await get(viewPath(organizationId, 'any', 'pricings'), { token: owner.token });

      expect(response.status).toBe(200);
      expect(names(response.body, 'pricings')).toEqual([open.serviceName]);
    });

    it('is still only for owners and admins', async () => {
      const { admin, member, outsider, organizationId } = await setup();

      for (const part of ['pricings', 'collections', 'hierarchy']) {
        const path = viewPath(organizationId, 'any', part);
        expect((await get(path)).status, `${part} anonymous`).toBe(401);
        expect((await get(path, { token: outsider.token })).status, `${part} outsider`).toBe(403);
        expect((await get(path, { token: member.token })).status, `${part} member`).toBe(403);
        expect((await get(path, { token: admin.token })).status, `${part} admin`).toBe(200);
      }
    });
  });

  it('needs a web session, not an API key', async () => {
    const { owner, member, organizationId } = await setup();
    const key = await request(app)
      .post(`${BASE_PATH}/users/${owner.username}/api-keys`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `key ${randomSuffix()}`, scopes: [{ organizationId, scope: 'ALL' }] });
    expect(key.status).toBe(201);

    const response = await get(viewPath(organizationId, member.id, 'pricings'), { key: key.body.plainKey });

    expect(response.status).toBe(403);
  });
});
