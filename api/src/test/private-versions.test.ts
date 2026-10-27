/**
 * Privacy is set per pricing version. A private version (its content, YAML,
 * label or existence) is only for callers allowed to read the private versions
 * of its pricing, by the rule of PermanentLinkService.authorize: OWNER/ADMIN of
 * the organization, a global ADMIN with a token, a member granted GET on the
 * pricing or on its collection, and API keys within their scopes (a VIEW key
 * acts as a plain member, MANAGEMENT at most as an ADMIN, and a key without a
 * scope on the organization reaches nothing). Public versions stay visible to
 * anyone.
 */
import dotenv from 'dotenv';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import unzipper from 'unzipper';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { randomSuffix } from './utils/helpers';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import { createTestCollection } from './utils/collections/collectionTestUtils';
import { createPricingForOrganization, createValidPricingYaml } from './utils/pricings/pricingTestUtils';
import {
  cleanupOrganization,
  createMembership,
  createOrgScopedPermission,
  createTestOrganization,
} from './utils/organizations';
import { createEntityScopedPermission } from './utils/organizations/organizationTestUtils';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import NotificationMongoose from '../main/repositories/mongoose/models/NotificationMongoose';
import PricingFollowMongoose from '../main/repositories/mongoose/models/PricingFollowMongoose';
import OrbitToolRunner from '../main/services/orbit/OrbitTools';

dotenv.config();

const FULL = { GET: true, PUT: true, DELETE: true, CREATE: true };
const NONE = { GET: false, PUT: false, DELETE: false, CREATE: false };

const label = () => `${Math.floor(Math.random() * 9000) + 1000}.${Math.floor(Math.random() * 900) + 100}.${Math.floor(Math.random() * 90) + 10}`;

describe('Private pricing versions are only for callers allowed to read them', { timeout: 60000 }, () => {
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
      const objectId = new mongoose.Types.ObjectId(organizationId);
      const versions: any[] = await PricingMongoose.find({ _organizationId: objectId }).select('yaml pricingId').lean();
      for (const version of versions) {
        if (typeof version.yaml === 'string' && version.yaml.startsWith('static/pricings/uploaded/')) {
          generatedFilesToDelete.add(path.resolve(process.cwd(), 'public', version.yaml));
        }
        if (version.pricingId) await PricingFollowMongoose.deleteMany({ pricingId: version.pricingId });
      }
      await PricingMongoose.deleteMany({ _organizationId: objectId });
      await PricingCollectionMongoose.deleteMany({ _organizationId: objectId });
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

  const newUser = async (prefix: string) => {
    const { user, organizationId } = await createAndLoginUser('USER', `${prefix}_${randomSuffix()}`);
    organizationsWithData.add(organizationId);
    return Object.assign(user as any, { personalOrganizationId: organizationId });
  };

  const newOrganization = async (owner: any, prefix = 'Org') => {
    const organization = await createTestOrganization(owner.token, { displayName: `${prefix} ${randomSuffix()}` });
    organizationsWithData.add(organization.id);
    return organization;
  };

  /** Publishes a version as `token`'s user, the way the web app uploads a YAML. */
  const publish = async (token: string, organizationId: string, name: string, version: string, isPrivate: boolean) => {
    const fixture = await createValidPricingYaml(name, version);
    return request(app)
      .post(`${BASE_PATH}/pricings/${organizationId}`)
      .set('Authorization', `Bearer ${token}`)
      .field('private', String(isPrivate))
      .attach('yaml', fixture.filePath);
  };

  /**
   * An organization with a pricing whose newest version is private and the
   * previous one public ("mixed"), and a pricing with a private version only
   * ("hidden"); a member without any permission and an outsider. Every
   * version label is unique, so finding one in a response is a leak.
   */
  const setup = async () => {
    const owner = await newUser('owner');
    const organization = await newOrganization(owner);
    const mixed = { name: `mixed-${randomSuffix()}`, publicVersion: label(), privateVersion: label() };
    await createPricingForOrganization({ organizationId: organization.id, serviceName: mixed.name, version: mixed.publicVersion });
    await createPricingForOrganization({ organizationId: organization.id, serviceName: mixed.name, version: mixed.privateVersion, isPrivate: true });
    // The private version is the newest one.
    await PricingMongoose.updateOne({ slug: mixed.name, version: mixed.publicVersion }, { $set: { createdAt: new Date('2020-01-01') } });
    const hidden = { name: `hidden-${randomSuffix()}`, version: label() };
    await createPricingForOrganization({ organizationId: organization.id, serviceName: hidden.name, version: hidden.version, isPrivate: true });

    const member = await newUser('member');
    await createMembership(member.id, organization.id, 'MEMBER');
    const outsider = await newUser('outsider');
    return { owner, organization, mixed, hidden, member, outsider };
  };

  const leaks = (body: unknown, ...versions: string[]) => {
    const text = JSON.stringify(body ?? null);
    return versions.some(version => text.includes(version));
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

  const versionsOf = (body: any): string[] => (body?.versions ?? []).map((version: any) => version.version);

  // ===========================================================================
  // 1. Fields the server manages are never taken from the client
  // ===========================================================================
  describe('PUT /pricings/{organizationId}/{slug} and server-managed fields', () => {
    it('refuses a stored file path, and the version keeps serving its own file', async () => {
      const { organization, hidden, outsider } = await setup();
      const target: any = await PricingMongoose.findOne({ slug: hidden.name, _organizationId: organization.id }).lean();
      const secret = await fs.readFile(path.resolve(process.cwd(), 'public', target.yaml), 'utf8');

      const ownName = `own-${randomSuffix()}`;
      expect((await publish(outsider.token, outsider.personalOrganizationId, ownName, '1.0.0', false)).status).toBe(200);
      const own: any = await PricingMongoose.findOne({ slug: ownName, _organizationId: outsider.personalOrganizationId }).lean();

      const response = await request(app)
        .put(`${BASE_PATH}/pricings/${outsider.personalOrganizationId}/${ownName}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ yaml: target.yaml });

      const served = await get(`${BASE_PATH}/public/pricings/${own.pricingId}/versions/${own._id}/yaml`);
      expect(served.text).not.toContain(hidden.name);
      expect(served.text).not.toEqual(secret);
      // Refused as invalid data, the API's answer to a request it does not take (422).
      expect(response.status).toBe(422);
      expect(response.body.error).toContain('yaml');
      expect(((await PricingMongoose.findById(own._id).lean()) as any).yaml).toBe(own.yaml);
    });

    it('refuses the collection, organization and analytics, and still takes name and visibility', async () => {
      const { owner, organization, outsider } = await setup();
      const collection = await createTestCollection({ _organizationId: organization.id, private: true, name: `col-${randomSuffix()}` });
      const ownName = `own-${randomSuffix()}`;
      expect((await publish(outsider.token, outsider.personalOrganizationId, ownName, '1.0.0', false)).status).toBe(200);
      const url = `${BASE_PATH}/pricings/${outsider.personalOrganizationId}/${ownName}`;
      const put = (body: Record<string, unknown>) => request(app).put(url).set('Authorization', `Bearer ${outsider.token}`).send(body);

      for (const body of [
        { _collectionId: collection.id },
        { _organizationId: organization.id },
        { analytics: { numberOfPlans: 99 } },
        { pricingId: new mongoose.Types.ObjectId().toString() },
        { version: '9.9.9' },
      ]) {
        const response = await put(body);
        expect(response.status, JSON.stringify(body)).toBe(422);
      }
      const stored: any = await PricingMongoose.findOne({ slug: ownName, _organizationId: outsider.personalOrganizationId }).lean();
      expect(stored._collectionId ?? null).toBeNull();
      expect(String(stored._organizationId)).toBe(outsider.personalOrganizationId);

      expect((await put({ private: true })).status).toBe(200);
      const renamed = await put({ name: `renamed-${randomSuffix()}` });
      expect(renamed.status).toBe(200);
      void owner;
    });

    it('does not place a new pricing in a collection of another organization, or in one the caller may not edit', async () => {
      const { organization, member, outsider } = await setup();
      const foreign = await createTestCollection({ _organizationId: organization.id, private: true, name: `foreign-${randomSuffix()}` });
      const upload = async (token: string, organizationId: string, collectionId: string) => {
        const fixture = await createValidPricingYaml(`placed-${randomSuffix()}`, '1.0.0');
        return request(app)
          .post(`${BASE_PATH}/pricings/${organizationId}`)
          .set('Authorization', `Bearer ${token}`)
          .field('private', 'false')
          .field('collectionId', collectionId)
          .attach('yaml', fixture.filePath);
      };

      const intoForeign = await upload(outsider.token, outsider.personalOrganizationId, foreign.id);
      expect(intoForeign.status).toBe(404);
      await createOrgScopedPermission(member.id, organization.id, 'pricing', { ...NONE, CREATE: true });
      const notEditable = await upload(member.token, organization.id, foreign.id);
      expect(notEditable.status).toBe(404);
      expect(await PricingMongoose.countDocuments({ _collectionId: foreign.id })).toBe(0);

      await createEntityScopedPermission(member.id, organization.id, foreign.slug, 'collection', { ...NONE, GET: true, PUT: true });
      expect((await upload(member.token, organization.id, foreign.id)).status).toBe(200);
    });

    it('never reads or rewrites a stored file outside the static folder', async () => {
      const { outsider } = await setup();
      const ownName = `own-${randomSuffix()}`;
      const version = '1.0.0';
      expect((await publish(outsider.token, outsider.personalOrganizationId, ownName, version, false)).status).toBe(200);

      // A row left behind by the old behaviour points outside `public/static`.
      const outside = path.resolve(process.cwd(), `outside-${randomSuffix()}.yml`);
      const original = (await createValidPricingYaml(`outside-${randomSuffix()}`, version)).filePath;
      await fs.copyFile(original, outside);
      generatedFilesToDelete.add(outside);
      const before = await fs.readFile(outside, 'utf8');
      await PricingMongoose.updateOne(
        { slug: ownName, _organizationId: outsider.personalOrganizationId },
        { $set: { yaml: `static/../../${path.basename(outside)}` } }
      );

      const space = await get(`${BASE_PATH}/pricings/${outsider.personalOrganizationId}/${ownName}/${version}`, { token: outsider.token });
      const renamed = await request(app)
        .put(`${BASE_PATH}/pricings/${outsider.personalOrganizationId}/${ownName}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ name: `renamed-${randomSuffix()}` });

      expect(await fs.readFile(outside, 'utf8')).toBe(before);
      expect(space.status).toBe(404);
      expect(renamed.status).toBe(200);
    });
  });

  // ===========================================================================
  // 2. Permissions are matched by organization and slug
  // ===========================================================================
  describe('permissions matched by slug across organizations', () => {
    it('does not show a private version of a same-named pricing in another organization', async () => {
      const { owner, member } = await setup();
      const slug = `twin-${randomSuffix()}`;
      const secretVersion = label();
      // Organization A: the member may read the pricing "twin".
      const orgA = await newOrganization(owner, 'A');
      await createPricingForOrganization({ organizationId: orgA.id, serviceName: slug, version: '1.0.0' });
      await createMembership(member.id, orgA.id, 'MEMBER');
      await createEntityScopedPermission(member.id, orgA.id, slug, 'pricing', { ...NONE, GET: true });
      // Organization B: a pricing with the same slug whose only version is private.
      const orgB = await newOrganization(owner, 'B');
      await createPricingForOrganization({ organizationId: orgB.id, serviceName: slug, version: secretVersion, isPrivate: true });
      await createMembership(member.id, orgB.id, 'MEMBER');

      const response = await get(`${BASE_PATH}/users/me/pricings?name=${slug}&limit=50`, { token: member.token });
      expect(response.status).toBe(200);
      expect(leaks(response.body, secretVersion)).toBe(false);
      expect(response.body.pricings.map((pricing: any) => pricing.organization?.id)).toEqual([orgA.id]);
    });

    it('does not let a collection permission in one organization reach a same-named collection of another', async () => {
      const { owner, member } = await setup();
      const collectionName = `twin-col-${randomSuffix()}`;
      const orgA = await newOrganization(owner, 'A');
      const inA = await createTestCollection({ _organizationId: orgA.id, name: collectionName, private: true });
      await createMembership(member.id, orgA.id, 'MEMBER');
      await createEntityScopedPermission(member.id, orgA.id, inA.slug, 'collection', { ...NONE, GET: true });

      const orgB = await newOrganization(owner, 'B');
      const inB = await createTestCollection({ _organizationId: orgB.id, name: collectionName, private: false });
      await createMembership(member.id, orgB.id, 'MEMBER');
      const secret = { name: `in-b-${randomSuffix()}`, version: label() };
      await createPricingForOrganization({ organizationId: orgB.id, serviceName: secret.name, version: secret.version, isPrivate: true });
      const added = await request(app)
        .post(`${BASE_PATH}/collections/${orgB.id}/${inB.slug}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ pricingSlug: secret.name });
      expect(added.status).toBe(200);

      const response = await get(`${BASE_PATH}/users/me/pricings?name=${secret.name}&limit=50`, { token: member.token });
      expect(response.status).toBe(200);
      expect(leaks(response.body, secret.version)).toBe(false);
      expect(response.body.pricings).toEqual([]);
    });
  });

  // ===========================================================================
  // 3. Collections do not hand out what the caller could not read
  // ===========================================================================
  describe('adding pricings to collections', () => {
    it('refuses to add a pricing with private versions to a collection the member edits, unless the member may read them', async () => {
      const { organization, mixed, hidden, member } = await setup();
      const collection = await createTestCollection({ _organizationId: organization.id, private: true, name: `mine-${randomSuffix()}` });
      await createEntityScopedPermission(member.id, organization.id, collection.slug, 'collection', FULL);
      const add = (pricingSlug: string) =>
        request(app)
          .post(`${BASE_PATH}/collections/${organization.id}/${collection.slug}`)
          .set('Authorization', `Bearer ${member.token}`)
          .send({ pricingSlug });

      const mixedAdded = await add(mixed.name);
      const after = await get(`${BASE_PATH}/pricings/${organization.id}/${mixed.name}`, { token: member.token });
      expect(versionsOf(after.body)).not.toContain(mixed.privateVersion);
      expect(mixedAdded.status).toBe(403);

      // A pricing it cannot see at all answers as one that does not exist.
      const hiddenAdded = await add(hidden.name);
      const missing = await add(`no-such-${randomSuffix()}`);
      expect(hiddenAdded.status).toBe(missing.status);
      expect(hiddenAdded.body).toEqual(missing.body);
      const stored: any = await PricingMongoose.findOne({ slug: hidden.name, _organizationId: organization.id }).lean();
      expect(stored._collectionId ?? null).toBeNull();

      // With GET on the pricing, it may be added; pricings with public versions only, as before.
      await createEntityScopedPermission(member.id, organization.id, mixed.name, 'pricing', { ...NONE, GET: true });
      expect((await add(mixed.name)).status).toBe(200);
      const open = await createPricingForOrganization({ organizationId: organization.id, serviceName: `open-${randomSuffix()}` });
      expect((await add(open.serviceName)).status).toBe(200);
    });

    it('refuses to create a collection holding a pricing whose private versions the member may not read', async () => {
      const { organization, mixed, member } = await setup();
      await createOrgScopedPermission(member.id, organization.id, 'collection', { ...NONE, CREATE: true });

      const created = await request(app)
        .post(`${BASE_PATH}/collections/${organization.id}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: `grab-${randomSuffix()}`, private: true, pricings: [mixed.name] });
      if (created.body?.id) collectionIdsToDelete.add(created.body.id);

      const after = await get(`${BASE_PATH}/pricings/${organization.id}/${mixed.name}`, { token: member.token });
      expect(versionsOf(after.body)).not.toContain(mixed.privateVersion);
      expect(created.status).toBe(403);
    });

    it('does not let ORBIT plan the same move', async () => {
      const { organization, mixed, member } = await setup();
      const collection = await createTestCollection({ _organizationId: organization.id, private: false, name: `orbit-${randomSuffix()}` });
      await createEntityScopedPermission(member.id, organization.id, collection.slug, 'collection', FULL);

      const result = await new OrbitToolRunner().runParsed('propose_plan', {
        summary: 'Mover',
        collectionChanges: [{ organizationId: organization.id, collection: collection.name, add: [mixed.name] }],
      }, {
        actor: { id: member.id, username: member.username, role: 'USER' },
        conversation: { id: new mongoose.Types.ObjectId().toString(), userId: member.id, title: '', messages: [], attachments: [] } as any,
        onPlan: () => {},
      }) as any;
      expect(result.ok).toBe(false);
      expect(leaks(result, mixed.privateVersion)).toBe(false);
    });
  });

  // ===========================================================================
  // 4. Forks, follows and notifications
  // ===========================================================================
  describe('forks, follows and notifications', () => {
    it('does not let a member without permission fork a private version', async () => {
      const { organization, mixed, hidden, member } = await setup();
      const fork = (sourceSlug: string, sourceVersion: string) =>
        request(app)
          .post(`${BASE_PATH}/pricing-forks`)
          .set('Authorization', `Bearer ${member.token}`)
          .send({
            sourceOrganizationId: organization.id,
            sourceSlug,
            sourceVersion,
            targetOrganizationId: member.personalOrganizationId,
            name: `fork-${randomSuffix()}`,
          });

      const privateFork = await fork(mixed.name, mixed.privateVersion);
      const hiddenFork = await fork(hidden.name, hidden.version);
      const missing = await fork(`no-such-${randomSuffix()}`, '1.0.0');
      expect(privateFork.status).toBe(404);
      expect(hiddenFork.status).toBe(404);
      expect(privateFork.body).toEqual(missing.body);
      expect(await PricingMongoose.countDocuments({ _organizationId: new mongoose.Types.ObjectId(member.personalOrganizationId) })).toBe(0);

      // A public version is forkable by anyone, as before.
      expect((await fork(mixed.name, mixed.publicVersion)).status).toBe(200);
    });

    it('does not let a member follow a pricing whose versions are all private', async () => {
      const { organization, mixed, hidden, member } = await setup();
      const url = (slug: string) => `${BASE_PATH}/pricing-follows/${organization.id}/${slug}`;
      const missing = await request(app).put(url(`no-such-${randomSuffix()}`)).set('Authorization', `Bearer ${member.token}`);

      const followed = await request(app).put(url(hidden.name)).set('Authorization', `Bearer ${member.token}`);
      expect(followed.status).toBe(missing.status);
      expect(followed.body).toEqual(missing.body);
      const status = await get(url(hidden.name), { token: member.token });
      expect(status.status).toBe(404);

      // A pricing with a public version can be followed by anyone signed in.
      expect((await request(app).put(url(mixed.name)).set('Authorization', `Bearer ${member.token}`)).status).toBe(200);
    });

    it('tells followers about a private version only if they may read it', async () => {
      const { owner, organization, mixed, member } = await setup();
      const reader = await newUser('reader');
      await createMembership(reader.id, organization.id, 'MEMBER');
      await createEntityScopedPermission(reader.id, organization.id, mixed.name, 'pricing', { ...NONE, GET: true });
      for (const user of [member, reader]) {
        expect((await request(app).put(`${BASE_PATH}/pricing-follows/${organization.id}/${mixed.name}`).set('Authorization', `Bearer ${user.token}`)).status).toBe(200);
      }

      const privateVersion = label();
      const publicVersion = label();
      expect((await publish(owner.token, organization.id, mixed.name, privateVersion, true)).status).toBe(200);
      expect((await publish(owner.token, organization.id, mixed.name, publicVersion, false)).status).toBe(200);

      const notified = async (userId: string, version: string) =>
        (await NotificationMongoose.countDocuments({ _userId: userId, kind: 'PricingUpdated', 'data.version': version })) > 0;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && !((await notified(member.id, publicVersion)) && (await notified(reader.id, privateVersion)))) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      expect(await notified(member.id, privateVersion)).toBe(false);
      expect(await notified(member.id, publicVersion)).toBe(true);
      expect(await notified(reader.id, privateVersion)).toBe(true);
    });
  });

  // ===========================================================================
  // The rule, with API keys, everywhere a pricing is read
  // ===========================================================================
  describe('API key scopes when reading pricings', () => {
    it('treats a VIEW key as a plain member and a key for another organization as no access', async () => {
      const { owner, organization, mixed, hidden, member } = await setup();
      const other = await newOrganization(owner, 'Other');
      const keys = {
        view: await createApiKey(owner, [{ organizationId: organization.id, scope: 'VIEW' }]),
        management: await createApiKey(owner, [{ organizationId: organization.id, scope: 'MANAGEMENT' }]),
        all: await createApiKey(owner, [{ organizationId: organization.id, scope: 'ALL' }]),
        other: await createApiKey(owner, [{ organizationId: other.id, scope: 'ALL' }]),
      };
      const detail = `${BASE_PATH}/pricings/${organization.id}/${mixed.name}`;
      const space = `${BASE_PATH}/pricings/${organization.id}/${mixed.name}/${mixed.privateVersion}`;
      const listing = `${BASE_PATH}/pricings/${organization.id}?limit=50`;
      const mine = `${BASE_PATH}/users/me/pricings?name=${hidden.name}&limit=50`;

      for (const key of [keys.view, keys.other]) {
        const shown = await get(detail, { key });
        expect(versionsOf(shown.body)).toEqual([mixed.publicVersion]);
        expect((await get(`${BASE_PATH}/pricings/${organization.id}/${hidden.name}`, { key })).status).toBe(404);
        expect((await get(space, { key })).status).toBe(404);
        expect(leaks((await get(listing, { key })).body, hidden.version, mixed.privateVersion)).toBe(false);
        expect(leaks((await get(mine, { key })).body, hidden.version)).toBe(false);
      }
      for (const key of [keys.management, keys.all]) {
        expect(versionsOf((await get(detail, { key })).body)).toContain(mixed.privateVersion);
        expect(leaks((await get(listing, { key })).body, hidden.version)).toBe(true);
      }

      // A member granted GET reads the private versions with a VIEW key of their own.
      await createEntityScopedPermission(member.id, organization.id, mixed.name, 'pricing', { ...NONE, GET: true });
      const memberKey = await createApiKey(member, [{ organizationId: organization.id, scope: 'VIEW' }]);
      expect(versionsOf((await get(detail, { key: memberKey })).body)).toContain(mixed.privateVersion);
    });

    it('does not apply the global ADMIN bypass to API keys', async () => {
      const { organization, hidden } = await setup();
      const key = await createApiKey(adminUser, [{ organizationId: organization.id, scope: 'ALL' }]);

      expect(leaks((await get(`${BASE_PATH}/pricings?name=${hidden.name}`, { key })).body, hidden.version)).toBe(false);
      expect((await get(`${BASE_PATH}/pricings/${organization.id}/${hidden.name}`, { key })).status).toBe(404);
      // With a token a global ADMIN still reads everything.
      expect((await get(`${BASE_PATH}/pricings/${organization.id}/${hidden.name}`, { token: adminUser.token })).status).toBe(200);
    });
  });

  // ===========================================================================
  // Other places a private version could reach a caller
  // ===========================================================================
  describe('other ways to reach private versions', () => {
    it('does not show private versions in the answer to a change made by someone who may not read them', async () => {
      const { organization, mixed, member } = await setup();
      await createEntityScopedPermission(member.id, organization.id, mixed.name, 'pricing', { ...NONE, PUT: true });

      const visibility = await request(app)
        .put(`${BASE_PATH}/pricings/${organization.id}/${mixed.name}/${mixed.publicVersion}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ private: false });
      expect(leaks(visibility.body, mixed.privateVersion)).toBe(false);

      const renamed = await request(app)
        .put(`${BASE_PATH}/pricings/${organization.id}/${mixed.name}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: `renamed-${randomSuffix()}` });
      expect(leaks(renamed.body, mixed.privateVersion)).toBe(false);
      // Changing every version, private ones included, takes reading them.
      expect(renamed.status).toBe(403);
    });

    it('returns only the versions the caller may read in the body of a write it may make', async () => {
      const { organization, member } = await setup();
      // A pricing whose newest version is public and an older one private.
      const older = { name: `older-${randomSuffix()}`, privateVersion: label(), publicVersion: label() };
      await createPricingForOrganization({ organizationId: organization.id, serviceName: older.name, version: older.privateVersion, isPrivate: true });
      await createPricingForOrganization({ organizationId: organization.id, serviceName: older.name, version: older.publicVersion });
      await PricingMongoose.updateOne({ slug: older.name, version: older.privateVersion }, { $set: { createdAt: new Date('2020-01-01') } });
      // A pricing with public versions only.
      const open = { name: `open-${randomSuffix()}`, first: label(), second: label() };
      await createPricingForOrganization({ organizationId: organization.id, serviceName: open.name, version: open.first });
      await createPricingForOrganization({ organizationId: organization.id, serviceName: open.name, version: open.second });
      for (const slug of [older.name, open.name]) {
        await createEntityScopedPermission(member.id, organization.id, slug, 'pricing', { ...NONE, PUT: true });
      }
      const put = (url: string, body: Record<string, unknown>) =>
        request(app).put(`${BASE_PATH}/pricings/${organization.id}/${url}`).set('Authorization', `Bearer ${member.token}`).send(body);

      // Making every version private is a change the member may make; the
      // answer then holds none of them, as the member can no longer read them.
      const hidden = await put(open.name, { private: true });
      expect(hidden.status, JSON.stringify(hidden.body)).toBe(200);
      expect(leaks(hidden.body, open.first, open.second)).toBe(false);

      const visibility = await put(`${older.name}/${older.publicVersion}`, { private: false });
      expect(visibility.status, JSON.stringify(visibility.body)).toBe(200);
      expect(versionsOf(visibility.body)).toEqual([older.publicVersion]);

      const renamed = await put(older.name, { name: `renamed-${randomSuffix()}` });
      expect(leaks(renamed.body, older.privateVersion)).toBe(false);
      expect(renamed.status).toBe(403);
    });

    it('does not tell a member that a pricing with only private versions exists through its permissions', async () => {
      const { owner, organization, hidden, member } = await setup();
      const url = (slug: string) => `${BASE_PATH}/pricings/${organization.id}/${slug}/permissions`;
      const missing = await get(url(`no-such-${randomSuffix()}`), { token: member.token });
      const present = await get(url(hidden.name), { token: member.token });
      expect(present.status).toBe(missing.status);
      expect(present.body).toEqual(missing.body);

      // Nor through the permissions of the organization.
      const reader = await newUser('reader');
      await createMembership(reader.id, organization.id, 'MEMBER');
      await createEntityScopedPermission(reader.id, organization.id, hidden.name, 'pricing', { ...NONE, GET: true });
      const listed = await get(`${BASE_PATH}/orgs/${organization.id}/permissions`, { token: member.token });
      expect(listed.status).toBe(200);
      expect(JSON.stringify(listed.body)).not.toContain(hidden.name);
      expect(JSON.stringify((await get(`${BASE_PATH}/orgs/${organization.id}/permissions`, { token: owner.token })).body)).toContain(hidden.name);
    });

    it('leaves private versions out of the ZIP of a public collection', async () => {
      const { owner, organization, mixed } = await setup();
      const collection = await createTestCollection({ _organizationId: organization.id, private: false, name: `zip-${randomSuffix()}` });
      expect((await request(app)
        .post(`${BASE_PATH}/collections/${organization.id}/${collection.slug}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ pricingSlug: mixed.name })).status).toBe(200);

      const download = async (auth?: { token?: string }) => {
        const call = get(`${BASE_PATH}/collections/${organization.id}/${collection.slug}/download`, auth)
          .buffer(true)
          .parse((res, callback) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => callback(null, Buffer.concat(chunks)));
          });
        const response = await call;
        expect(response.status).toBe(200);
        const archive = await unzipper.Open.buffer(response.body as Buffer);
        return archive.files.map(file => file.path);
      };

      const anonymous = await download();
      expect(anonymous.some(name => name.includes(mixed.privateVersion))).toBe(false);
      expect(anonymous.some(name => name.includes(mixed.publicVersion))).toBe(true);
      expect((await download({ token: owner.token })).some(name => name.includes(mixed.privateVersion))).toBe(true);
    });

    it('does not serve the configuration space of a private version through the public cache endpoint', async () => {
      const { owner, organization, mixed } = await setup();
      const computed = await get(`${BASE_PATH}/pricings/${organization.id}/${mixed.name}/${mixed.privateVersion}`, { token: owner.token });
      expect(computed.status).toBe(200);
      expect(computed.body.configurationSpaceSize).toBeGreaterThan(0);

      const cached = await request(app)
        .get(`${BASE_PATH}/cache?key=${encodeURIComponent(`${organization.id}.${mixed.name}.${mixed.privateVersion}.configurationSpace`)}`)
        .set('Origin', 'http://localhost');
      expect(Array.isArray(cached.body)).toBe(false);

      // Entries the server keeps for itself can neither be read nor written there.
      for (const key of [`internal:configuration-space:${randomSuffix()}`, `sso:flow:${randomSuffix()}`]) {
        const written = await request(app).post(`${BASE_PATH}/cache`).set('Origin', 'http://localhost').send({ key, value: { x: 1 }, expirationInSeconds: 60 });
        expect(written.status).toBe(403);
        const read = await request(app).get(`${BASE_PATH}/cache?key=${encodeURIComponent(key)}`).set('Origin', 'http://localhost');
        expect(read.status).toBe(403);
      }
    });

    it('counts only the versions a member may read in ORBIT\'s list of resources', async () => {
      const { owner, organization, member } = await setup();
      const older = { name: `older-${randomSuffix()}`, privateVersion: label(), publicVersion: label() };
      await createPricingForOrganization({ organizationId: organization.id, serviceName: older.name, version: older.privateVersion, isPrivate: true });
      await createPricingForOrganization({ organizationId: organization.id, serviceName: older.name, version: older.publicVersion });
      await PricingMongoose.updateOne({ slug: older.name, version: older.privateVersion }, { $set: { createdAt: new Date('2020-01-01') } });

      const run = (user: any) =>
        new OrbitToolRunner().runParsed('list_resources', { organizationId: organization.id, type: 'pricing' }, {
          actor: { id: user.id, username: user.username, role: 'USER' },
          conversation: { id: '', userId: user.id, title: '', messages: [], attachments: [] } as any,
          onPlan: () => {},
        }) as Promise<any>;

      const listed = (await run(member)).pricings.find((pricing: any) => pricing.slug === older.name);
      expect(listed).toMatchObject({ private: false, versions: 1 });
      expect((await run(owner)).pricings.find((pricing: any) => pricing.slug === older.name)).toMatchObject({ versions: 2 });
    });
  });

  // ===========================================================================
  // The MCP server applies the scopes of its key like the REST API
  // ===========================================================================
  describe('MCP server', () => {
    let nextId = 1;
    const callTool = async (key: string, name: string, args: Record<string, unknown>) => {
      const response = await request(app)
        .post(`${BASE_PATH}/orbit/mcp`)
        .set('x-api-key', key)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
      expect(response.status).toBe(200);
      return { data: JSON.parse(response.body.result.content[0].text), isError: response.body.result.isError === true };
    };

    it('reads private versions and private collections with a VIEW key only as a plain member would', async () => {
      const { owner, organization, mixed, hidden, member } = await setup();
      const collection = await createTestCollection({ _organizationId: organization.id, private: true, name: `secret-col-${randomSuffix()}` });
      const view = await createApiKey(owner, [{ organizationId: organization.id, scope: 'VIEW' }]);

      const pricing = await callTool(view, 'get_pricing', { organizationId: organization.id, pricing: mixed.name });
      expect(versionsOf(pricing.data)).toEqual([mixed.publicVersion]);
      expect(leaks((await callTool(view, 'search_pricings', { organizationId: organization.id, query: hidden.name })).data, hidden.version)).toBe(false);
      expect((await callTool(view, 'get_configuration_space', { organizationId: organization.id, pricing: mixed.name, version: mixed.privateVersion })).isError).toBe(true);
      expect((await callTool(view, 'compare_pricing_versions', {
        organizationId: organization.id, pricing: mixed.name, from: mixed.publicVersion, to: mixed.privateVersion,
      })).isError).toBe(true);
      const resources = await callTool(view, 'list_resources', { organizationId: organization.id });
      expect(JSON.stringify(resources.data)).not.toContain(hidden.name);
      expect(JSON.stringify(resources.data)).not.toContain(collection.name);
      const shownCollection = await callTool(view, 'get_collection', { organizationId: organization.id, collection: collection.name });
      expect(shownCollection.isError).toBe(true);
      // A pricing with private versions only answers like one that does not exist.
      const hiddenPricing = await callTool(view, 'get_pricing', { organizationId: organization.id, pricing: hidden.name });
      const missingPricing = await callTool(view, 'get_pricing', { organizationId: organization.id, pricing: `no-such-${randomSuffix()}` });
      expect(hiddenPricing.isError).toBe(true);
      expect(hiddenPricing.data.error.replace(hidden.name, '')).toBe(missingPricing.data.error.replace(/no-such-\S+?"/, '"'));

      // A member granted GET on the pricing reads it with a VIEW key: the setup for read-only assistants.
      await createEntityScopedPermission(member.id, organization.id, mixed.name, 'pricing', { ...NONE, GET: true });
      const memberKey = await createApiKey(member, [{ organizationId: organization.id, scope: 'VIEW' }]);
      expect(versionsOf((await callTool(memberKey, 'get_pricing', { organizationId: organization.id, pricing: mixed.name })).data)).toContain(mixed.privateVersion);
    });

    it('reads everything the user may see with MANAGEMENT and ALL keys', async () => {
      const { owner, organization, mixed, hidden } = await setup();
      const collection = await createTestCollection({ _organizationId: organization.id, private: true, name: `secret-col-${randomSuffix()}` });
      for (const scope of ['MANAGEMENT', 'ALL']) {
        const key = await createApiKey(owner, [{ organizationId: organization.id, scope }]);
        expect(versionsOf((await callTool(key, 'get_pricing', { organizationId: organization.id, pricing: mixed.name })).data)).toContain(mixed.privateVersion);
        expect(leaks((await callTool(key, 'search_pricings', { organizationId: organization.id, query: hidden.name })).data, hidden.version)).toBe(true);
        expect((await callTool(key, 'get_configuration_space', { organizationId: organization.id, pricing: mixed.name, version: mixed.privateVersion })).isError).toBe(false);
        expect(JSON.stringify((await callTool(key, 'list_resources', { organizationId: organization.id })).data)).toContain(hidden.name);
        expect((await callTool(key, 'get_collection', { organizationId: organization.id, collection: collection.name })).isError).toBe(false);
      }
    });
  });
});
