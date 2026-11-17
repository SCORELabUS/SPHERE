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

dotenv.config();

const NONE = { GET: false, PUT: false, DELETE: false, CREATE: false };

const label = () => `${Math.floor(Math.random() * 9000) + 1000}.${Math.floor(Math.random() * 900) + 100}.${Math.floor(Math.random() * 90) + 10}`;

describe('Unlisted pricings', { timeout: 60000 }, () => {
  let app: TestApp;
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
      .field('private', String(options.private ?? false));
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
});
