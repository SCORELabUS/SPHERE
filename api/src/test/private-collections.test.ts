/**
 * A private collection is visible only to who may GET it (OWNER/ADMIN of its
 * organization, an explicit GET on it, a global ADMIN, an API key within its
 * scope). Anyone else must not learn that it exists, its name, slug or id, or
 * which pricings it holds. The public versions of the pricings in it stay
 * visible, but without the collection: to such a caller they read exactly like
 * pricings in no collection.
 */
import dotenv from 'dotenv';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { shutdownApp, TestApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { randomSuffix } from './utils/helpers';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import { createTestCollection } from './utils/collections/collectionTestUtils';
import { createPricingForOrganization } from './utils/pricings/pricingTestUtils';
import { createBulkZipFixture, removeTempPaths } from './utils/pricingFixtures';
import { cleanupOrganization, createMembership, createTestOrganization } from './utils/organizations';
import { createEntityScopedPermission } from './utils/organizations/organizationTestUtils';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import OrbitToolRunner from '../main/services/orbit/OrbitTools';

dotenv.config();

const FULL = { GET: true, PUT: true, DELETE: true, CREATE: true };

describe('Private collections are not revealed to callers without permission', { timeout: 30000 }, () => {
  let app: TestApp;
  const adminUser: any = testContainer.resolve('adminUser');
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const orgsToDelete: Set<string> = testContainer.resolve('orgsToDelete');
  const collectionIdsToDelete: Set<string> = testContainer.resolve('collectionIdsToDelete');
  const generatedFilesToDelete: Set<string> = testContainer.resolve('generatedFilesToDelete');
  const organizationsWithData = new Set<string>();

  beforeAll(async () => {
    app = testContainer.resolve('app');
  });

  afterEach(async () => {
    for (const organizationId of organizationsWithData) {
      await PricingMongoose.deleteMany({ _organizationId: new mongoose.Types.ObjectId(organizationId) });
      await PricingCollectionMongoose.deleteMany({ _organizationId: new mongoose.Types.ObjectId(organizationId) });
    }
    organizationsWithData.clear();
    for (const collectionId of collectionIdsToDelete) await PricingCollectionMongoose.deleteOne({ _id: collectionId });
    collectionIdsToDelete.clear();
    for (const username of usersToDelete) await deleteTestUser(username);
    usersToDelete.clear();
    for (const organizationId of orgsToDelete) await cleanupOrganization(organizationId);
    orgsToDelete.clear();
    for (const filePath of generatedFilesToDelete) await fs.rm(filePath, { force: true, recursive: true });
    generatedFilesToDelete.clear();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  const newUser = async (prefix: string) =>
    (await createAndLoginUser('USER', `${prefix}_${randomSuffix()}`)).user as any;

  /**
   * An organization with a private collection holding a pricing whose only
   * version is public, plus a public collection and a member without any
   * permission. Every name is unique, so finding it in a response is a leak.
   */
  const setup = async () => {
    const owner = await newUser('owner');
    const organization = await createTestOrganization(owner.token, { displayName: `Org ${randomSuffix()}` });
    organizationsWithData.add(organization.id);
    const hidden = await createTestCollection({
      _organizationId: organization.id,
      name: `hidden-col-${randomSuffix()}`,
      private: true,
    });
    const open = await createTestCollection({
      _organizationId: organization.id,
      name: `open-col-${randomSuffix()}`,
      private: false,
    });
    const pricing = await createPricingForOrganization({
      organizationId: organization.id,
      serviceName: `shown-${randomSuffix()}`,
    });
    const added = await request(app)
      .post(`${BASE_PATH}/collections/${organization.id}/${hidden.slug}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ pricingSlug: pricing.serviceName });
    expect(added.status).toBe(200);

    const member = await newUser('member');
    await createMembership(member.id, organization.id, 'MEMBER');
    const outsider = await newUser('outsider');
    return { owner, organization, hidden, open, pricing, member, outsider };
  };

  /** Whether a response mentions the collection in any way. */
  const mentions = (body: unknown, collection: { id: string; slug: string; name: string }) => {
    const text = JSON.stringify(body);
    return [collection.id, collection.slug, collection.name].some(value => text.includes(value));
  };

  const createApiKey = async (user: any, scopes: Array<{ organizationId: string; scope: string }>) => {
    const response = await request(app)
      .post(`${BASE_PATH}/users/${user.username}/api-keys`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `key ${randomSuffix()}`, scopes });
    expect(response.status).toBe(201);
    return response.body.plainKey as string;
  };

  const get = (url: string, auth?: { token?: string; key?: string }) => {
    const call = request(app).get(url);
    if (auth?.token) call.set('Authorization', `Bearer ${auth.token}`);
    if (auth?.key) call.set('x-api-key', auth.key);
    return call;
  };

  // ===========================================================================
  // The collection itself
  // ===========================================================================
  describe('GET /collections/{organizationId}/{slug}', () => {
    it('answers callers without permission exactly as for a collection that does not exist', async () => {
      const { owner, organization, hidden, member, outsider } = await setup();
      const url = (slug: string) => `${BASE_PATH}/collections/${organization.id}/${slug}`;
      const missing = await get(url(`no-such-${randomSuffix()}`));
      expect(missing.status).toBe(404);

      for (const auth of [undefined, { token: outsider.token }, { token: member.token }]) {
        for (const suffix of ['', '/download']) {
          const response = await get(`${url(hidden.slug)}${suffix}`, auth);
          expect(response.status).toBe(404);
          expect(response.body).toEqual(missing.body);
        }
      }

      expect((await get(url(hidden.slug), { token: owner.token })).status).toBe(200);
      expect((await get(url(hidden.slug), { token: adminUser.token })).status).toBe(200);
      await createEntityScopedPermission(member.id, organization.id, hidden.slug, 'collection', { ...FULL, PUT: false, DELETE: false, CREATE: false });
      expect((await get(url(hidden.slug), { token: member.token })).status).toBe(200);
    });

    it('applies the scope of an API key: VIEW acts as a plain member, and a key for another organization sees nothing', async () => {
      const { owner, organization, hidden } = await setup();
      const other = await createTestOrganization(owner.token, { displayName: `Other ${randomSuffix()}` });
      const url = `${BASE_PATH}/collections/${organization.id}/${hidden.slug}`;

      const viewKey = await createApiKey(owner, [{ organizationId: organization.id, scope: 'VIEW' }]);
      const otherKey = await createApiKey(owner, [{ organizationId: other.id, scope: 'ALL' }]);
      const allKey = await createApiKey(owner, [{ organizationId: organization.id, scope: 'ALL' }]);

      expect((await get(url, { key: viewKey })).status).toBe(404);
      expect((await get(url, { key: otherKey })).status).toBe(404);
      expect((await get(url, { key: allKey })).status).toBe(200);

      const listed = await get(`${BASE_PATH}/collections/${organization.id}`, { key: otherKey });
      expect(listed.status).toBe(200);
      expect(mentions(listed.body, hidden)).toBe(false);
    });

    it('does not tell an organization member without permission that the collection exists', async () => {
      const { organization, hidden, member } = await setup();
      const missingSlug = `no-such-${randomSuffix()}`;

      const permissions = (slug: string) =>
        get(`${BASE_PATH}/collections/${organization.id}/${slug}/permissions`, { token: member.token });
      const missingPermissions = await permissions(missingSlug);
      const hiddenPermissions = await permissions(hidden.slug);
      expect(missingPermissions.status).toBe(404);
      expect(hiddenPermissions.status).toBe(missingPermissions.status);
      expect(hiddenPermissions.body).toEqual(missingPermissions.body);

      const update = (slug: string) =>
        request(app)
          .put(`${BASE_PATH}/collections/${organization.id}/${slug}`)
          .set('Authorization', `Bearer ${member.token}`)
          .send({ description: 'changed' });
      const missingUpdate = await update(missingSlug);
      const hiddenUpdate = await update(hidden.slug);
      expect(hiddenUpdate.status).toBe(missingUpdate.status);
      expect(hiddenUpdate.body).toEqual(missingUpdate.body);
    });

    it('does not list a private collection through a permission on a same-named collection of another organization', async () => {
      const { organization, hidden, member } = await setup();
      const owner2 = await newUser('owner2');
      const other = await createTestOrganization(owner2.token, { displayName: `Twin ${randomSuffix()}` });
      organizationsWithData.add(other.id);
      // The same slug in another organization, where the member may see it.
      await createTestCollection({ _organizationId: other.id, name: hidden.name, private: true });
      await createMembership(member.id, other.id, 'MEMBER');
      await createEntityScopedPermission(member.id, other.id, hidden.slug, 'collection', FULL);

      const response = await get(`${BASE_PATH}/users/me/collections?limit=50`, { token: member.token });
      expect(response.status).toBe(200);
      const listed = response.body.collections.map((collection: any) => `${collection.organization.id}:${collection.slug}`);
      expect(listed).toContain(`${other.id}:${hidden.slug}`);
      expect(listed).not.toContain(`${organization.id}:${hidden.slug}`);
    });
  });

  // ===========================================================================
  // Pricing listings
  // ===========================================================================
  describe('GET /pricings and GET /pricings/{organizationId}', () => {
    it('does not list the pricings of a private collection by its slug', async () => {
      const { owner, hidden, pricing, outsider } = await setup();
      const url = `${BASE_PATH}/pricings?collection=${hidden.slug}&limit=50`;

      for (const auth of [undefined, { token: outsider.token }]) {
        const response = await get(url, auth);
        expect(response.status).toBe(200);
        expect(response.body.pricings).toEqual([]);
      }

      const authorized = await get(url, { token: owner.token });
      expect(authorized.body.pricings.map((item: any) => item.name)).toContain(pricing.serviceName);
    });

    it('lists the public pricing without its private collection', async () => {
      const { owner, organization, hidden, pricing, member, outsider } = await setup();
      const urls = [
        `${BASE_PATH}/pricings?name=${pricing.serviceName}`,
        `${BASE_PATH}/pricings/${organization.id}?name=${pricing.serviceName}`,
      ];
      for (const url of urls) {
        for (const auth of [undefined, { token: outsider.token }, { token: member.token }]) {
          const response = await get(url, auth);
          expect(response.status).toBe(200);
          expect(response.body.pricings.map((item: any) => item.name)).toEqual([pricing.serviceName]);
          expect(mentions(response.body, hidden)).toBe(false);
        }
        const authorized = await get(url, { token: owner.token });
        expect(authorized.body.pricings[0].collection).toMatchObject({ id: hidden.id, slug: hidden.slug, name: hidden.name });
      }

      const mine = await get(`${BASE_PATH}/users/me/pricings?name=${pricing.serviceName}`, { token: member.token });
      expect(mine.status).toBe(200);
      expect(mine.body.pricings.map((item: any) => item.name)).toEqual([pricing.serviceName]);
      expect(mentions(mine.body, hidden)).toBe(false);
    });

    it('treats a pricing in a hidden collection as one in no collection when excluding collected pricings', async () => {
      const { owner, pricing } = await setup();
      const url = `${BASE_PATH}/pricings?name=${pricing.serviceName}&excludePricingsInCollection=true`;

      const anonymous = await get(url);
      expect(anonymous.body.pricings.map((item: any) => item.name)).toEqual([pricing.serviceName]);
      const authorized = await get(url, { token: owner.token });
      expect(authorized.body.pricings).toEqual([]);
    });
  });

  // ===========================================================================
  // One pricing
  // ===========================================================================
  describe('GET /pricings/{organizationId}/{slug}', () => {
    it('serves the public versions without the collection', async () => {
      const { owner, organization, hidden, pricing, member, outsider } = await setup();
      const url = `${BASE_PATH}/pricings/${organization.id}/${pricing.serviceName}`;

      for (const auth of [undefined, { token: outsider.token }, { token: member.token }]) {
        const response = await get(url, auth);
        expect(response.status).toBe(200);
        expect(response.body.versions).toHaveLength(1);
        expect(mentions(response.body, hidden)).toBe(false);
      }

      const authorized = await get(url, { token: owner.token });
      expect(authorized.body.collection).toMatchObject({ id: hidden.id, slug: hidden.slug, name: hidden.name });
      expect(authorized.body.versions[0].collectionName).toBe(hidden.name);
    });

    it('cannot be used to confirm the slug of the collection a pricing is in', async () => {
      const { owner, organization, hidden, pricing, outsider } = await setup();
      const url = (query: string) => `${BASE_PATH}/pricings/${organization.id}/${pricing.serviceName}?${query}`;
      const versionUrl = (query: string) =>
        `${BASE_PATH}/pricings/${organization.id}/${pricing.serviceName}/${pricing.version}?${query}`;

      for (const auth of [undefined, { token: outsider.token }]) {
        const wrong = await get(url(`collection=no-such-${randomSuffix()}`), auth);
        expect(wrong.status).toBe(404);
        const right = await get(url(`collection=${hidden.slug}`), auth);
        expect(right.status).toBe(wrong.status);
        expect(right.body).toEqual(wrong.body);
        const byId = await get(url(`collectionId=${hidden.id}`), auth);
        expect(byId.status).toBe(wrong.status);

        const wrongVersion = await get(versionUrl(`collection=no-such-${randomSuffix()}`), auth);
        const rightVersion = await get(versionUrl(`collection=${hidden.slug}`), auth);
        expect(wrongVersion.status).toBe(404);
        expect(rightVersion.status).toBe(wrongVersion.status);
      }

      expect((await get(url(`collection=${hidden.slug}`), { token: owner.token })).status).toBe(200);
    });

    it('links the YAML of a version uploaded with the collection without the collection folder, and the link works', async () => {
      const owner = await newUser('bulk');
      const organization = await createTestOrganization(owner.token, { displayName: `Bulk ${randomSuffix()}` });
      organizationsWithData.add(organization.id);
      const name = `hidden-bulk-${randomSuffix()}`;
      const { zipPath, tempPaths } = await createBulkZipFixture();
      generatedFilesToDelete.add(zipPath);
      const created = await request(app)
        .post(`${BASE_PATH}/collections/${organization.id}/bulk`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('name', name)
        .field('private', 'true')
        .attach('zip', zipPath);
      await removeTempPaths(tempPaths);
      expect(created.status).toBe(201);
      const collection = await PricingCollectionMongoose.findOne({ _organizationId: organization.id, name }).lean();
      expect(collection?.private).toBe(true);
      generatedFilesToDelete.add(path.resolve(process.cwd(), 'public', 'static', 'collections', organization.id));
      const stored: any = await PricingMongoose.findOne({ _organizationId: organization.id }).lean();
      expect(stored.yaml).toContain(name);
      const ref = { id: String(collection!._id), slug: collection!.slug, name };
      const pricingUrl = `${BASE_PATH}/pricings/${organization.id}/${stored.slug}`;

      const expectHiddenButServed = async () => {
        const anonymous = await get(pricingUrl);
        expect(anonymous.status).toBe(200);
        expect(mentions(anonymous.body, ref)).toBe(false);
        const yaml = await request(app).get(new URL(anonymous.body.versions[0].yaml).pathname);
        expect(yaml.status).toBe(200);
        expect(yaml.text).toContain('saasName');
        const authorized = await get(pricingUrl, { token: owner.token });
        expect(authorized.body.versions[0].yaml).toContain(stored.yaml);
      };

      // The uploaded pricing is in the collection.
      expect(String(stored._collectionId)).toBe(ref.id);
      await expectHiddenButServed();

      // Taken out of it, its file stays in the collection's folder.
      const removed = await request(app)
        .delete(`${BASE_PATH}/collections/${organization.id}/${ref.slug}/pricings/${stored.slug}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(removed.status).toBe(200);
      await expectHiddenButServed();
    });

    it('denies individual PUT without revealing the private collection', async () => {
      const { organization, hidden, pricing, member } = await setup();
      await createEntityScopedPermission(member.id, organization.id, pricing.serviceName, 'pricing', FULL);

      const visibility = await request(app)
        .put(`${BASE_PATH}/pricings/${organization.id}/${pricing.serviceName}/${pricing.version}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ private: false });
      expect(visibility.status).toBe(403);
      expect(mentions(visibility.body, hidden)).toBe(false);

      const update = await request(app)
        .put(`${BASE_PATH}/pricings/${organization.id}/${pricing.serviceName}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({});
      expect(update.status).toBe(403);
      expect(mentions(update.body, hidden)).toBe(false);
    });
  });

  // ===========================================================================
  // Links, forks and moves
  // ===========================================================================
  describe('permanent links, forks and moves', () => {
    it('resolves the permanent link of the pricing without naming the collection', async () => {
      const { owner, hidden, pricing, outsider } = await setup();
      const stored: any = await PricingMongoose.findById(pricing.id).lean();
      const url = `${BASE_PATH}/permalinks/pricing/${stored.pricingId}`;

      for (const auth of [undefined, { token: outsider.token }]) {
        const response = await get(url, auth);
        expect(response.status).toBe(200);
        expect(mentions(response.body, hidden)).toBe(false);
      }
      expect((await get(url, { token: owner.token })).body.location).toContain(`collection=${hidden.slug}`);
    });

    it('keeps the source collection out of a fork for whoever may not see it', async () => {
      const { owner, organization, hidden, pricing, outsider } = await setup();
      const fork = (user: any, targetOrganizationId: string) =>
        request(app)
          .post(`${BASE_PATH}/pricing-forks`)
          .set('Authorization', `Bearer ${user.token}`)
          .send({
            sourceOrganizationId: organization.id,
            sourceSlug: pricing.serviceName,
            sourceVersion: pricing.version,
            targetOrganizationId,
            name: `fork-${randomSuffix()}`,
          });

      const outsiderOrg = await createTestOrganization(outsider.token, { displayName: `Fork ${randomSuffix()}` });
      organizationsWithData.add(outsiderOrg.id);
      const byOutsider = await fork(outsider, outsiderOrg.id);
      expect(byOutsider.status).toBe(200);
      expect(mentions(byOutsider.body, hidden)).toBe(false);

      // Forked by the owner, who may see the collection: readers of the fork may not.
      const ownerOrg = await createTestOrganization(owner.token, { displayName: `Mine ${randomSuffix()}` });
      organizationsWithData.add(ownerOrg.id);
      const byOwner = await fork(owner, ownerOrg.id);
      expect(byOwner.status).toBe(200);
      const forkUrl = `${BASE_PATH}/pricings/${ownerOrg.id}/${byOwner.body.slug}`;
      const anonymous = await get(forkUrl);
      expect(anonymous.status).toBe(200);
      expect(anonymous.body.versions[0].forkedFrom.name).toBe(pricing.serviceName);
      expect(mentions(anonymous.body, hidden)).toBe(false);
      expect((await get(forkUrl, { token: owner.token })).body.versions[0].forkedFrom.collectionName).toBe(hidden.name);
    });

    it('does not let someone who may not see the collection move its pricings out of it', async () => {
      const { organization, hidden, open, pricing, member } = await setup();
      await createEntityScopedPermission(member.id, organization.id, open.slug, 'collection', FULL);

      const moved = await request(app)
        .post(`${BASE_PATH}/collections/${organization.id}/${open.slug}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ pricingSlug: pricing.serviceName });
      expect(moved.status).toBe(403);
      expect(mentions(moved.body, hidden)).toBe(false);

      const stored: any = await PricingMongoose.findById(pricing.id).lean();
      expect(String(stored._collectionId)).toBe(hidden.id);
    });
  });

  // ===========================================================================
  // ORBIT and MCP
  // ===========================================================================
  describe('ORBIT and the MCP server', () => {
    const runner = new OrbitToolRunner();
    const run = (user: any, name: string, args: Record<string, unknown>) =>
      runner.runParsed(name, args, {
        actor: { id: user.id, username: user.username, role: user.role ?? 'USER' },
        conversation: { id: '', userId: user.id, title: '', messages: [], attachments: [] } as any,
        onPlan: () => {},
      }) as Promise<any>;

    it('does not name the collection of a pricing to a member who may not see it', async () => {
      const { organization, hidden, pricing, member } = await setup();

      const resources = await run(member, 'list_resources', { organizationId: organization.id });
      expect(resources.pricings.map((item: any) => item.name)).toContain(pricing.serviceName);
      expect(mentions(resources, hidden)).toBe(false);

      const search = await run(member, 'search_pricings', { organizationId: organization.id, query: pricing.serviceName });
      expect(search.pricings.map((item: any) => item.name)).toEqual([pricing.serviceName]);
      expect(mentions(search, hidden)).toBe(false);

      const detail = await run(member, 'get_pricing', { organizationId: organization.id, pricing: pricing.serviceName });
      expect(detail.name).toBe(pricing.serviceName);
      expect(mentions(detail, hidden)).toBe(false);
    });

    it('answers a member asking for the collection, or planning changes to it, as for one that does not exist', async () => {
      const { organization, hidden, open, pricing, member } = await setup();
      await createEntityScopedPermission(member.id, organization.id, open.slug, 'collection', FULL);
      const missing = `no-such-${randomSuffix()}`;
      const sameAnswer = (forHidden: unknown, forMissing: unknown) =>
        expect(JSON.stringify(forHidden).split(hidden.name).join('?')).toBe(JSON.stringify(forMissing).split(missing).join('?'));

      sameAnswer(
        await run(member, 'get_collection', { organizationId: organization.id, collection: hidden.name }),
        await run(member, 'get_collection', { organizationId: organization.id, collection: missing })
      );

      const plan = (collection: string) =>
        run(member, 'propose_plan', {
          summary: 'Cambios',
          collectionChanges: [{ organizationId: organization.id, collection, add: [pricing.serviceName] }],
        });
      sameAnswer(await plan(hidden.name), await plan(missing));

      // Moving its pricing elsewhere does not tell where it comes from.
      const move = await run(member, 'propose_plan', {
        summary: 'Cambios',
        collectionChanges: [{ organizationId: organization.id, collection: open.name, add: [pricing.serviceName] }],
      });
      expect(mentions(move, hidden)).toBe(false);
    });

    it('does not name private collections of organizations an MCP key does not reach', async () => {
      const { owner, hidden, pricing } = await setup();
      const other = await createTestOrganization(owner.token, { displayName: `Reach ${randomSuffix()}` });
      const key = await createApiKey(owner, [{ organizationId: other.id, scope: 'VIEW' }]);

      const response = await request(app)
        .post(`${BASE_PATH}/orbit/mcp`)
        .set('x-api-key', key)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_pricings', arguments: { query: pricing.serviceName } } });
      expect(response.status).toBe(200);
      const data = JSON.parse(response.body.result.content[0].text);
      expect(data.pricings.map((item: any) => item.name)).toEqual([pricing.serviceName]);
      expect(mentions(data, hidden)).toBe(false);
    });
  });
});
