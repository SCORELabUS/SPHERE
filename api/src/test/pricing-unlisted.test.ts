/**
 * Unlisted pricings ("anyone with the link"): whether a pricing is listed is the
 * pricing's (`unlisted`, the same on every version), apart from the privacy of
 * each version (`private`). An unlisted pricing reads like a public one by its
 * URL, but listings only show it to whoever may read its private versions
 * (OWNER/ADMIN of its organization, GET on it or on its collection, a global
 * ADMIN with a token; API keys within their scopes).
 */
import dotenv from 'dotenv';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp, TestApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { randomSuffix } from './utils/helpers';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import { createTestCollection } from './utils/collections/collectionTestUtils';
import { createValidPricingYaml } from './utils/pricings/pricingTestUtils';
import { cleanupOrganization, createMembership, createTestOrganization } from './utils/organizations';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import PricingFollowMongoose from '../main/repositories/mongoose/models/PricingFollowMongoose';
import EntityPermissionMongoose from '../main/repositories/mongoose/models/EntityPermissionMongoose';
import container from '../main/config/container';
import OrganizationMongoose from '../main/repositories/mongoose/models/OrganizationMongoose';
import NotificationMongoose from '../main/repositories/mongoose/models/NotificationMongoose';
import OrbitToolRunner from '../main/services/orbit/OrbitTools';
import unzipper from 'unzipper';
import { createEntityScopedPermission } from './utils/organizations/organizationTestUtils';

dotenv.config();

const NONE = { GET: false, PUT: false, DELETE: false, CREATE: false };

const label = () => `${Math.floor(Math.random() * 9000) + 1000}.${Math.floor(Math.random() * 900) + 100}.${Math.floor(Math.random() * 90) + 10}`;

describe('Unlisted pricings', { timeout: 60000 }, () => {
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

  const newOrganization = async (owner: any, prefix = 'Unlisted') => {
    const organization = await createTestOrganization(owner.token, { displayName: `${prefix} ${randomSuffix()}` });
    organizationsWithData.add(organization.id);
    return organization;
  };

  /** Publishes a version as `token`'s user, the way the web app uploads a YAML. */
  const publish = async (
    token: string,
    organizationId: string,
    name: string,
    version: string,
    options: { private?: boolean; unlisted?: string } = {}
  ) => {
    const fixture = await createValidPricingYaml(name, version);
    const call = request(app)
      .post(`${BASE_PATH}/pricings/${organizationId}`)
      .set('Authorization', `Bearer ${token}`)
      .field('private', String(options.private ?? false))
      // The upload names its file after these, so two pricings never share one.
      .field('saasName', name)
      .field('version', version);
    if (options.unlisted !== undefined) call.field('unlisted', options.unlisted);
    return call.attach('yaml', fixture.filePath);
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

  const put = (url: string, body: object, auth: { token?: string; key?: string }, ifMatch?: string) => {
    const call = request(app).put(url);
    if (auth.token) call.set('Authorization', `Bearer ${auth.token}`);
    if (auth.key) call.set('x-api-key', auth.key);
    if (ifMatch) call.set('If-Match', ifMatch);
    return call.send(body);
  };

  const storedFlags = async (slug: string, organizationId: string) =>
    (await PricingMongoose.find({ slug, _organizationId: new mongoose.Types.ObjectId(organizationId) }).select('version private unlisted').lean())
      .map((version: any) => ({ version: version.version, private: version.private === true, unlisted: version.unlisted === true }));

  /** An organization of `owner` with an unlisted pricing of two public versions. */
  const unlistedPricing = async (owner: any, organization: any) => {
    const name = `unlisted-${randomSuffix()}`;
    const versions = [label(), label()];
    const first = await publish(owner.token, organization.id, name, versions[0], { unlisted: 'true' });
    expect(first.status).toBe(200);
    expect((await publish(owner.token, organization.id, name, versions[1])).status).toBe(200);
    const slug = first.body.slug as string;
    return { name, slug, versions, url: `${BASE_PATH}/pricings/${organization.id}/${slug}` };
  };

  describe('Storing whether a pricing is listed', () => {
    it('Unlists a pricing with PUT, makes every version visible with the link and reports it on show. (CA-1.4, CA-1.5)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const name = `mixed-${randomSuffix()}`;
      const [publicVersion, privateVersion] = [label(), label()];
      const first = await publish(owner.token, organization.id, name, publicVersion);
      await publish(owner.token, organization.id, name, privateVersion, { private: true });
      const url = `${BASE_PATH}/pricings/${organization.id}/${first.body.slug}`;

      const before = await get(url, { token: owner.token }).expect(200);
      expect(before.body.unlisted).toBe(false);

      const response = await put(url, { private: false, unlisted: true }, { token: owner.token });
      expect(response.status).toBe(200);
      expect(response.body.unlisted).toBe(true);

      const after = await get(url, { token: owner.token }).expect(200);
      expect(after.body.unlisted).toBe(true);
      expect(after.body.versions.map((version: any) => version.private)).toEqual([false, false]);
      expect(await storedFlags(first.body.slug, organization.id)).toEqual(expect.arrayContaining([
        { version: publicVersion, private: false, unlisted: true },
        { version: privateVersion, private: false, unlisted: true },
      ]));
    });

    it('Creates an unlisted pricing from an upload. (CA-2.2)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const created = await publish(owner.token, organization.id, `new-${randomSuffix()}`, label(), { unlisted: 'true' });
      expect(created.status).toBe(200);
      expect(await storedFlags(created.body.slug, organization.id)).toEqual([expect.objectContaining({ unlisted: true })]);
      const shown = await get(`${BASE_PATH}/pricings/${organization.id}/${created.body.slug}`).expect(200);
      expect(shown.body.unlisted).toBe(true);
    });

    it('Reads a version stored before the field existed as listed. (CA-7.5)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const created = await publish(owner.token, organization.id, `legacy-${randomSuffix()}`, label());
      await PricingMongoose.collection.updateMany({ slug: created.body.slug, _organizationId: new mongoose.Types.ObjectId(organization.id) }, { $unset: { unlisted: '' } });
      const shown = await get(`${BASE_PATH}/pricings/${organization.id}/${created.body.slug}`).expect(200);
      expect(shown.body.unlisted).toBe(false);
    });

    it('Keeps a pricing unlisted when a version is added by an upload, the version route or the repository (ZIP, fork, ORBIT). (CA-3.2, CA-3.3)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const pricing = await unlistedPricing(owner, organization);

      // An upload that names the pricing again, sending unlisted=false.
      const upload = await publish(owner.token, organization.id, pricing.name, label(), { unlisted: 'false' });
      expect(upload.status).toBe(200);

      // The editor's route for a new version, which never reads unlisted.
      const editorVersion = label();
      const fixture = await createValidPricingYaml(pricing.name, editorVersion);
      const byVersionRoute = await request(app)
        .post(`${pricing.url}/${editorVersion}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .field('private', 'false')
        .field('unlisted', 'false')
        .field('createdAt', new Date().toISOString())
        .attach('yaml', fixture.filePath);
      expect(byVersionRoute.status).toBe(200);

      // Every other way in (ZIP uploads, forks, ORBIT) inserts through the repository.
      const existing: any = await PricingMongoose.findOne({ slug: pricing.slug, _organizationId: new mongoose.Types.ObjectId(organization.id) }).lean();
      const repositoryVersion = label();
      const { _id, __v, addedAt, ...copy } = existing;
      await container.resolve('pricingRepository').create([{ ...copy, version: repositoryVersion, unlisted: false }]);

      const flags = await storedFlags(pricing.slug, organization.id);
      expect(flags).toHaveLength(5);
      expect(flags.every(version => version.unlisted)).toBe(true);

      const shown = await get(pricing.url).expect(200);
      expect(shown.body.unlisted).toBe(true);
      expect(shown.body.versions.map((version: any) => version.version)).toEqual(expect.arrayContaining([editorVersion, repositoryVersion]));
    });

    it('Changes only the privacy of the versions with private, never whether the pricing is listed. (CA-8.2)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const pricing = await unlistedPricing(owner, organization);

      await put(pricing.url, { private: true }, { token: owner.token }).expect(200);
      let flags = await storedFlags(pricing.slug, organization.id);
      expect(flags.every(version => version.private && version.unlisted)).toBe(true);

      await put(pricing.url, { private: false }, { token: owner.token }).expect(200);
      flags = await storedFlags(pricing.slug, organization.id);
      expect(flags.every(version => !version.private && version.unlisted)).toBe(true);

      const listed = await publish(owner.token, organization.id, `listed-${randomSuffix()}`, label());
      await put(`${BASE_PATH}/pricings/${organization.id}/${listed.body.slug}`, { private: false }, { token: owner.token }).expect(200);
      expect((await storedFlags(listed.body.slug, organization.id))[0].unlisted).toBe(false);
    });

    it('Changes one version and never the listing through the version route. (CA-8.3)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const pricing = await unlistedPricing(owner, organization);

      await put(`${pricing.url}/${pricing.versions[0]}`, { private: true, unlisted: false }, { token: owner.token }).expect(200);
      const flags = await storedFlags(pricing.slug, organization.id);
      expect(flags).toEqual(expect.arrayContaining([
        { version: pricing.versions[0], private: true, unlisted: true },
        { version: pricing.versions[1], private: false, unlisted: true },
      ]));
    });

    it('Honours If-Match: a stale tag gets 412 and changes nothing; a current one moves the ETag on. (CA-8.4)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const listed = await publish(owner.token, organization.id, `etag-${randomSuffix()}`, label());
      const url = `${BASE_PATH}/pricings/${organization.id}/${listed.body.slug}`;

      const stale = (await get(url, { token: owner.token }).expect(200)).headers.etag;
      await put(url, { url: 'https://example.com/changed' }, { token: owner.token }).expect(200);
      const current = (await get(url, { token: owner.token }).expect(200)).headers.etag;
      expect(current).not.toBe(stale);

      await put(url, { unlisted: true }, { token: owner.token }, stale).expect(412);
      expect((await storedFlags(listed.body.slug, organization.id))[0].unlisted).toBe(false);

      const changed = await put(url, { unlisted: true }, { token: owner.token }, current);
      expect(changed.status).toBe(200);
      expect(changed.headers.etag).toBeDefined();
      expect(changed.headers.etag).not.toBe(current);
      expect((await storedFlags(listed.body.slug, organization.id))[0].unlisted).toBe(true);
    });

    it('Takes PUT on the pricing, or on its collection, to change the listing; a VIEW key cannot. (CA-8.5)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const member = await newUser('member');
      await createMembership(member.id, organization.id, 'MEMBER');
      const collection = await createTestCollection({ _organizationId: organization.id, name: `col-${randomSuffix()}` });
      collectionIdsToDelete.add(collection.id);
      const listed = await publish(owner.token, organization.id, `perm-${randomSuffix()}`, label());
      const url = `${BASE_PATH}/pricings/${organization.id}/${listed.body.slug}`;
      await request(app).post(`${BASE_PATH}/collections/${organization.id}/${collection.slug}`)
        .set('Authorization', `Bearer ${owner.token}`).send({ pricingSlug: listed.body.slug }).expect(200);
      // Self-granted on publish would hide the case: the member never had any.
      await EntityPermissionMongoose.deleteMany({ _userId: member.id, _organizationId: organization.id });

      await put(url, { unlisted: true }, { token: member.token }).expect(403);
      expect((await storedFlags(listed.body.slug, organization.id))[0].unlisted).toBe(false);

      const viewKey = await createApiKey(owner, [{ organizationId: organization.id, scope: 'VIEW' }]);
      await put(url, { unlisted: true }, { key: viewKey }).expect(403);
      expect((await storedFlags(listed.body.slug, organization.id))[0].unlisted).toBe(false);

      await EntityPermissionMongoose.updateOne(
        { _userId: member.id, _organizationId: organization.id, entityType: 'collection', entitySlug: collection.slug },
        { $set: { permissions: { ...NONE, GET: true, PUT: true } } },
        { upsert: true }
      );
      await put(url, { unlisted: true }, { token: member.token }).expect(200);
      expect((await storedFlags(listed.body.slug, organization.id))[0].unlisted).toBe(true);
    });

    it('Refuses any value of unlisted other than a boolean, in a JSON body and in an upload.', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const listed = await publish(owner.token, organization.id, `values-${randomSuffix()}`, label());
      const url = `${BASE_PATH}/pricings/${organization.id}/${listed.body.slug}`;
      for (const value of ['1', 'yes', null, 1]) {
        const response = await put(url, { unlisted: value }, { token: owner.token });
        expect(response.status, `unlisted=${JSON.stringify(value)}`).toBe(422);
      }
      expect((await storedFlags(listed.body.slug, organization.id))[0].unlisted).toBe(false);
      const upload = await publish(owner.token, organization.id, `values-${randomSuffix()}`, label(), { unlisted: 'yes' });
      expect(upload.status).toBe(422);
    });

    it('Forks an unlisted pricing into an unlisted one, and a public one into a listed one, keeping the privacy and origin. (CA-21.1, CA-21.2, CA-21.3)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const forker = await newUser('forker');
      const unlisted = await unlistedPricing(owner, organization);
      const listed = await publish(owner.token, organization.id, `listed-${randomSuffix()}`, label());

      const fork = async (sourceSlug: string, sourceVersion: string) => {
        const name = `fork-${randomSuffix()}`;
        const response = await request(app)
          .post(`${BASE_PATH}/pricing-forks`)
          .set('Authorization', `Bearer ${forker.token}`)
          .send({ sourceOrganizationId: organization.id, sourceSlug, sourceVersion, targetOrganizationId: forker.personalOrganizationId, name });
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return PricingMongoose.findOne({ name, _organizationId: new mongoose.Types.ObjectId(forker.personalOrganizationId) }).lean() as any;
      };

      const unlistedFork = await fork(unlisted.slug, unlisted.versions[0]);
      expect(unlistedFork.unlisted).toBe(true);
      expect(unlistedFork.private).toBe(false);
      expect(String(unlistedFork.forkedFrom.organizationId)).toBe(organization.id);

      const listedFork = await fork(listed.body.slug, listed.body.version);
      expect(listedFork.unlisted).toBe(false);
      expect(listedFork.private).toBe(false);
      expect(listedFork.forkedFrom.slug).toBe(listed.body.slug);
    });
  });

  // ===========================================================================
  // Listings: an unlisted pricing is listed exactly to who may read its private
  // versions (in the global search too), and read like a public one by its URL.
  // ===========================================================================
  describe('Listings', () => {
    let nextId = 1;
    const callMcp = async (key: string, name: string, args: Record<string, unknown>) => {
      const response = await request(app)
        .post(`${BASE_PATH}/orbit/mcp`)
        .set('x-api-key', key)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
      expect(response.status).toBe(200);
      return { data: JSON.parse(response.body.result.content[0].text), isError: response.body.result.isError === true };
    };

    const orbit = (user: any, name: string, args: Record<string, unknown>) =>
      new OrbitToolRunner().runParsed(name, args, {
        actor: { id: user.id, username: user.username, role: user.role === 'ADMIN' ? 'ADMIN' : 'USER' },
        conversation: { id: new mongoose.Types.ObjectId().toString(), userId: user.id, title: '', messages: [], attachments: [] } as any,
        onPlan: () => {},
      }) as Promise<any>;

    /**
     * Organization O (below R), with a public collection C holding a pricing
     * whose versions are all private (`hidden`), an unlisted one (`unlisted`)
     * and a listed public one (`listed`, the control). Every name carries the
     * same unique tag, so a name filter finds only these three.
     */
    const presenceSetup = async () => {
      const tag = `presence${randomSuffix()}`.replace(/[^a-zA-Z0-9]/g, '');
      const parentOwner = await newUser('parentowner');
      const parent = await newOrganization(parentOwner, 'Parent');
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      await OrganizationMongoose.updateOne({ _id: organization.id }, { $set: { _parentId: new mongoose.Types.ObjectId(parent.id), ancestors: [new mongoose.Types.ObjectId(parent.id)] } });
      const collection = await createTestCollection({ _organizationId: organization.id, name: `col-${tag}` });
      collectionIdsToDelete.add(collection.id);

      const names = { hidden: `${tag}-hidden`, unlisted: `${tag}-unlisted`, listed: `${tag}-listed` };
      const slugs: Record<string, string> = {};
      for (const [kind, name] of Object.entries(names)) {
        const response = await publish(owner.token, organization.id, name, label(), {
          private: kind === 'hidden', unlisted: kind === 'unlisted' ? 'true' : undefined,
        });
        expect(response.status).toBe(200);
        slugs[kind] = response.body.slug;
        await request(app).post(`${BASE_PATH}/collections/${organization.id}/${collection.slug}`)
          .set('Authorization', `Bearer ${owner.token}`).send({ pricingSlug: response.body.slug }).expect(200);
      }

      const member = async (prefix: string, grants: Array<['pricing' | 'collection', string]>, role: 'MEMBER' | 'ADMIN' = 'MEMBER') => {
        const user = await newUser(prefix);
        await createMembership(user.id, organization.id, role);
        for (const [type, slug] of grants) await createEntityScopedPermission(user.id, organization.id, slug, type, { ...NONE, GET: true });
        return user;
      };
      const profiles: Record<string, any> = {
        outsider: await newUser('outsider'),
        member: await member('member', []),
        memberGetPricing: await member('getpricing', [['pricing', slugs.hidden], ['pricing', slugs.unlisted]]),
        memberGetCollection: await member('getcollection', [['collection', collection.slug]]),
        admin: await member('admin', [], 'ADMIN'),
        owner,
        parentOwner,
        globalAdmin: adminUser,
      };
      const keys: Record<string, string> = {
        globalAdminKey: await createApiKey(adminUser, [{ organizationId: organization.id, scope: 'ALL' }]),
        viewKey: await createApiKey(owner, [{ organizationId: organization.id, scope: 'VIEW' }]),
        managementKey: await createApiKey(owner, [{ organizationId: organization.id, scope: 'MANAGEMENT' }]),
        allKey: await createApiKey(owner, [{ organizationId: organization.id, scope: 'ALL' }]),
      };
      return { tag, organization, parent, collection, names, slugs, profiles, keys };
    };

    type Presence = 'SS' | 'SN' | 'NS' | 'NN';
    /** What each listing shows of [hidden (all private), unlisted]: S shown, N not. */
    const EXPECTED: Record<string, Partial<Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7a' | 'L7b', Presence>>> = {
      anonymous: { L1: 'NN', L2: 'NN', L3: 'NN' },
      outsider: { L1: 'NN', L2: 'NN', L3: 'NN', L4: 'NN', L5: 'NN', L6: 'NN' },
      member: { L1: 'NN', L2: 'NN', L3: 'NN', L4: 'NN', L5: 'NN', L6: 'NN' },
      memberGetPricing: { L1: 'NS', L2: 'SS', L3: 'SS', L4: 'SS', L5: 'SS', L6: 'NS' },
      memberGetCollection: { L1: 'NS', L2: 'SS', L3: 'SS', L4: 'SS', L5: 'SS', L6: 'NS' },
      admin: { L1: 'NS', L2: 'SS', L3: 'SS', L4: 'SS', L5: 'SS', L6: 'NS' },
      owner: { L1: 'NS', L2: 'SS', L3: 'SS', L4: 'SS', L5: 'SS', L6: 'NS' },
      parentOwner: { L1: 'NS', L2: 'SS', L3: 'SS', L4: 'NN', L5: 'SS', L6: 'NS' },
      globalAdmin: { L1: 'SS', L2: 'SS', L3: 'SS', L4: 'SS', L5: 'SS', L6: 'SS' },
      globalAdminKey: { L1: 'NN', L2: 'NN', L3: 'NN', L4: 'NN', L7a: 'NN' },
      viewKey: { L1: 'NN', L2: 'NN', L3: 'NN', L4: 'NN', L7a: 'NN', L7b: 'NN' },
      managementKey: { L1: 'NS', L2: 'SS', L3: 'SS', L4: 'SS', L7a: 'NS', L7b: 'SS' },
      allKey: { L1: 'NS', L2: 'SS', L3: 'SS', L4: 'SS', L7a: 'NS', L7b: 'SS' },
    };

    it('Lists an unlisted pricing exactly where the private one is listed, and in the global search to who may read it. (CA-4, CA-5, CA-23.1)', { timeout: 240000 }, async () => {
      const f = await presenceSetup();
      const names = (items: any[] | undefined) => new Set((items ?? []).map(item => item.name));
      const listing = async (profile: string, list: string): Promise<{ shown: Set<string>; total?: number; count?: number }> => {
        const user = f.profiles[profile];
        const key = f.keys[profile];
        const auth = user ? { token: user.token } : key ? { key } : undefined;
        switch (list) {
          case 'L1': {
            const body = (await get(`${BASE_PATH}/pricings?name=${f.tag}&limit=50`, auth).expect(200)).body;
            return { shown: names(body.pricings), total: body.total };
          }
          case 'L2': {
            const body = (await get(`${BASE_PATH}/pricings/${f.organization.id}?name=${f.tag}&limit=50`, auth).expect(200)).body;
            return { shown: names(body.pricings), total: body.total };
          }
          case 'L3': {
            // The collection only gives a count: the control plus what the caller may see.
            const body = (await get(`${BASE_PATH}/collections/${f.organization.id}?limit=50`, auth).expect(200)).body;
            const item = (body.collections ?? body).find((collection: any) => collection.slug === f.collection.slug);
            return { shown: new Set<string>(), count: item?.numberOfPricings ?? 0 };
          }
          case 'L4': {
            const body = (await get(`${BASE_PATH}/users/me/pricings?name=${f.tag}&limit=50`, auth).expect(200)).body;
            return { shown: names(body.pricings) };
          }
          case 'L5':
            return { shown: names((await orbit(user, 'search_pricings', { organizationId: f.organization.id, query: f.tag })).pricings) };
          case 'L6':
            return { shown: names((await orbit(user, 'search_pricings', { query: f.tag })).pricings) };
          case 'L7a':
            return { shown: names((await callMcp(key, 'search_pricings', { query: f.tag })).data.pricings) };
          case 'L7b':
            return { shown: names((await callMcp(key, 'search_pricings', { organizationId: f.organization.id, query: f.tag })).data.pricings) };
        }
        throw new Error(list);
      };

      const failures: string[] = [];
      for (const [profile, lists] of Object.entries(EXPECTED)) {
        for (const [list, expected] of Object.entries(lists)) {
          const { shown, total, count } = await listing(profile, list);
          // A count tells "both" (3) from "neither" (1); anything else is a difference
          // between the private pricing and the unlisted one.
          const actual = list === 'L3'
            ? (count === 3 ? 'SS' : count === 1 ? 'NN' : `count ${count}`)
            : `${shown.has(f.names.hidden) ? 'S' : 'N'}${shown.has(f.names.unlisted) ? 'S' : 'N'}`;
          if (actual !== expected) failures.push(`${profile} ${list}: expected ${expected}, got ${actual}`);
          if (list !== 'L3' && list !== 'L4' && !shown.has(f.names.listed)) failures.push(`${profile} ${list}: the listed control is missing`);
          // The total never counts what the listing hides (CA-4).
          if (total !== undefined && total !== shown.size) failures.push(`${profile} ${list}: total ${total} for ${shown.size} shown`);
        }
      }
      expect(failures).toEqual([]);
    });

    it('Lists an unlisted pricing in the search through each way of reading it, and never through a slug of another organization or a sibling. (L-002 V1-V7, N1, N2)', async () => {
      const f = await presenceSetup();
      const searched = async (auth: { token?: string; key?: string }) =>
        ((await get(`${BASE_PATH}/pricings?name=${f.tag}&limit=50`, auth).expect(200)).body.pricings as any[]).map(item => item.name);

      // V4: GET on the pricing only, with its collection not granted.
      const onlyPricing = await newUser('onlypricing');
      await createMembership(onlyPricing.id, f.organization.id, 'MEMBER');
      await createEntityScopedPermission(onlyPricing.id, f.organization.id, f.slugs.unlisted, 'pricing', { ...NONE, GET: true });
      expect(await searched({ token: onlyPricing.token })).toContain(f.names.unlisted);

      // V7: the same owner and request, only the scope of the key changes.
      expect(await searched({ key: f.keys.managementKey })).toContain(f.names.unlisted);
      expect(await searched({ key: f.keys.viewKey })).not.toContain(f.names.unlisted);

      // N1: GET on a pricing with the same slug in another organization.
      const other = await newOrganization(f.profiles.owner, 'Other');
      const sameSlug = await newUser('sameslug');
      await createMembership(sameSlug.id, other.id, 'MEMBER');
      await createEntityScopedPermission(sameSlug.id, other.id, f.slugs.unlisted, 'pricing', { ...NONE, GET: true });
      await createEntityScopedPermission(sameSlug.id, other.id, f.collection.slug, 'collection', { ...NONE, GET: true });
      expect(await searched({ token: sameSlug.token })).not.toContain(f.names.unlisted);

      // N2: OWNER of a sibling of the organization, below the same parent.
      const siblingOwner = await newUser('siblingowner');
      const sibling = await newOrganization(siblingOwner, 'Sibling');
      await OrganizationMongoose.updateOne({ _id: sibling.id }, { $set: { _parentId: new mongoose.Types.ObjectId(f.parent.id), ancestors: [new mongoose.Types.ObjectId(f.parent.id)] } });
      expect(await searched({ token: siblingOwner.token })).not.toContain(f.names.unlisted);
    });

    it('Reads an unlisted pricing like a public one by its URL, and its private versions still not. (CA-6, CA-8.1)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const outsider = await newUser('outsider');
      const pricing = await unlistedPricing(owner, organization);
      const privateVersion = label();
      await publish(owner.token, organization.id, pricing.name, privateVersion, { private: true });

      const shown = await get(pricing.url).expect(200);
      expect(shown.body.unlisted).toBe(true);
      expect(shown.body.versions.map((version: any) => version.version).sort()).toEqual([...pricing.versions].sort());
      expect(shown.body.versions.every((version: any) => version.private === false)).toBe(true);

      const stored: any[] = await PricingMongoose.find({ slug: pricing.slug, _organizationId: new mongoose.Types.ObjectId(organization.id) }).lean();
      const pricingId = String(stored[0].pricingId);
      const publicDoc = stored.find(version => version.version === pricing.versions[0]);
      const privateDoc = stored.find(version => version.version === privateVersion);

      const permalink = await get(`${BASE_PATH}/permalinks/pricing/${pricingId}?version=${publicDoc._id}`).expect(200);
      expect(permalink.body.location).toContain(`/pricings/${organization.id}/`);
      expect(permalink.body.location).toContain(String(publicDoc._id));
      await get(`${BASE_PATH}/public/pricings/${pricingId}`).expect(200);
      await get(`${BASE_PATH}/public/pricings/${pricingId}/versions/${publicDoc._id}/yaml`).expect(200);
      await get(`${BASE_PATH}/public/pricings/${pricingId}/download`).expect(200);
      await get(`/${publicDoc.yaml}`).expect(200);
      await get(`${pricing.url}/${pricing.versions[0]}`).expect(200);
      const graph = await get(`${BASE_PATH}/pricing-graphs/${organization.id}/${pricing.slug}`).expect(200);
      expect(JSON.stringify(graph.body)).not.toContain(privateVersion);

      // Its private version is still for who may read it only.
      expect(JSON.stringify(shown.body)).not.toContain(privateVersion);
      await get(`${BASE_PATH}/public/pricings/${pricingId}/versions/${privateDoc._id}/yaml`).expect(404);
      await get(`${pricing.url}/${privateVersion}`).expect(404);

      // Another user follows it and forks it.
      await request(app).put(`${BASE_PATH}/pricing-follows/${organization.id}/${pricing.slug}`).set('Authorization', `Bearer ${outsider.token}`).expect(200);
      const fork = await request(app).post(`${BASE_PATH}/pricing-forks`).set('Authorization', `Bearer ${outsider.token}`).send({
        sourceOrganizationId: organization.id, sourceSlug: pricing.slug, sourceVersion: pricing.versions[0],
        targetOrganizationId: outsider.personalOrganizationId, name: `fork-${randomSuffix()}`,
      });
      expect(fork.status).toBe(200);

      // Listings still carry each version's own `private`.
      const mine = (await get(`${BASE_PATH}/pricings/${organization.id}?limit=50`, { token: owner.token }).expect(200)).body.pricings
        .find((item: any) => item.slug === pricing.slug);
      expect(mine).toMatchObject({ unlisted: true });
      expect(typeof mine.private).toBe('boolean');
    });

    it('Keeps public and private pricings as they were for anonymous callers. (CA-7.2, CA-7.3, CA-7.6)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const listed = await publish(owner.token, organization.id, `listed-${randomSuffix()}`, label());
      const hidden = await publish(owner.token, organization.id, `hidden-${randomSuffix()}`, label(), { private: true });

      const anonymous = (await get(`${BASE_PATH}/pricings/${organization.id}?limit=50`).expect(200)).body.pricings.map((item: any) => item.slug);
      expect(anonymous).toContain(listed.body.slug);
      expect(anonymous).not.toContain(hidden.body.slug);

      const hiddenDoc: any = await PricingMongoose.findOne({ slug: hidden.body.slug, _organizationId: new mongoose.Types.ObjectId(organization.id) }).lean();
      await get(`${BASE_PATH}/pricings/${organization.id}/${hidden.body.slug}`).expect(404);
      await get(`${BASE_PATH}/permalinks/pricing/${hiddenDoc.pricingId}`).expect(404);
      await get(`${BASE_PATH}/public/pricings/${hiddenDoc.pricingId}`).expect(404);
      // The file of a private version answers like a missing one (StaticFilesMiddleware).
      const missing = await get(`/static/pricings/uploaded/missing-${randomSuffix()}.yml`);
      const hiddenFile = await get(`/${hiddenDoc.yaml}`);
      expect(hiddenFile.status).not.toBe(200);
      expect(hiddenFile.status).toBe(missing.status);
      expect(hiddenFile.text ?? '').not.toContain('saasName');

      const listedDoc: any = await PricingMongoose.findOne({ slug: listed.body.slug, _organizationId: new mongoose.Types.ObjectId(organization.id) }).lean();
      const manifest = (await get(`${BASE_PATH}/public/pricings/${listedDoc.pricingId}`).expect(200)).body;
      expect(Object.keys(manifest).sort()).toEqual(['latestVersionId', 'name', 'permanentUrl', 'pricingId', 'versions']);
      expect(Object.keys(manifest.versions[0]).sort()).toEqual(['contentHash', 'createdAt', 'version', 'versionId']);
    });

    it('Notifies the followers of an unlisted pricing of its new versions, also when it was unlisted after they followed. (CA-22)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const follower = await newUser('follower');
      const listed = await publish(owner.token, organization.id, `follow-${randomSuffix()}`, label());
      const url = `${BASE_PATH}/pricings/${organization.id}/${listed.body.slug}`;
      await request(app).put(`${BASE_PATH}/pricing-follows/${organization.id}/${listed.body.slug}`).set('Authorization', `Bearer ${follower.token}`).expect(200);
      await put(url, { unlisted: true }, { token: owner.token }).expect(200);

      const before = await NotificationMongoose.countDocuments({ _userId: follower.id });
      expect((await publish(owner.token, organization.id, listed.body.name ?? '', label())).status).toBe(200);
      await expect.poll(async () => NotificationMongoose.countDocuments({ _userId: follower.id }), { timeout: 5000 }).toBeGreaterThan(before);
    });

    it('Tells ORBIT a pricing is unlisted and never calls making its versions public listing it. (CA-23.2, CA-23.3)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const outsider = await newUser('outsider');
      const pricing = await unlistedPricing(owner, organization);

      const read = await orbit(outsider, 'get_pricing', { organizationId: organization.id, pricing: pricing.slug });
      expect(read.unlisted).toBe(true);
      expect(read.versions.map((version: any) => version.version).sort()).toEqual([...pricing.versions].sort());

      const searched = await orbit(owner, 'search_pricings', { organizationId: organization.id, query: pricing.name });
      expect(searched.pricings.find((item: any) => item.slug === pricing.slug)).toMatchObject({ unlisted: true });
      const resources = await orbit(owner, 'list_resources', { organizationId: organization.id, type: 'pricing' });
      expect(resources.pricings.find((item: any) => item.slug === pricing.slug)).toMatchObject({ unlisted: true });
      const member = await newUser('member');
      await createMembership(member.id, organization.id, 'MEMBER');
      const memberResources = await orbit(member, 'list_resources', { organizationId: organization.id, type: 'pricing' });
      expect(JSON.stringify(memberResources)).not.toContain(pricing.slug);

      const proposal = await orbit(owner, 'propose_plan', {
        summary: 'Make it public',
        visibilityChanges: [{ organizationId: organization.id, pricing: pricing.slug, private: false }],
      });
      const warnings = JSON.stringify(proposal.warnings ?? proposal.plan?.warnings ?? []);
      expect(warnings).toContain('stays unlisted');
      expect(warnings).not.toContain('already public');
    });

    it('Leaves an unlisted pricing out of the collection download for who may not read it. (CA-24)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const collection = await createTestCollection({ _organizationId: organization.id, name: `zip-${randomSuffix()}` });
      collectionIdsToDelete.add(collection.id);
      const pricing = await unlistedPricing(owner, organization);
      const listed = await publish(owner.token, organization.id, `zip-listed-${randomSuffix()}`, label());
      for (const slug of [pricing.slug, listed.body.slug]) {
        await request(app).post(`${BASE_PATH}/collections/${organization.id}/${collection.slug}`)
          .set('Authorization', `Bearer ${owner.token}`).send({ pricingSlug: slug }).expect(200);
      }
      const member = await newUser('member');
      await createMembership(member.id, organization.id, 'MEMBER');
      const reader = await newUser('reader');
      await createMembership(reader.id, organization.id, 'MEMBER');
      await createEntityScopedPermission(reader.id, organization.id, pricing.slug, 'pricing', { ...NONE, GET: true });

      const entries = async (auth?: { token: string }) => {
        const response = await get(`${BASE_PATH}/collections/${organization.id}/${collection.slug}/download`, auth)
          .buffer(true).parse((res, done) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks))); });
        expect(response.status).toBe(200);
        const directory = await unzipper.Open.buffer(response.body as Buffer);
        return directory.files.map(file => file.path).join('\n');
      };
      for (const auth of [undefined, { token: member.token }]) {
        const files = await entries(auth);
        expect(files).not.toContain(`${pricing.name}/`);
        expect(files).toContain(`${listed.body.name}/`);
      }
      for (const auth of [{ token: owner.token }, { token: reader.token }]) {
        expect(await entries(auth)).toContain(`${pricing.name}/`);
      }
    });
  });
});
