/**
 * Anonymous links: a random token shows one version of a pricing to anyone,
 * with nothing that names who published it, alike for every caller. Who may
 * edit the pricing creates, lists and revokes them; a private version is never
 * shared this way, and every token that shows nothing answers the same 404.
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
import { createEntityScopedPermission } from './utils/organizations/organizationTestUtils';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import PricingFollowMongoose from '../main/repositories/mongoose/models/PricingFollowMongoose';
import PricingIdentityMongoose from '../main/repositories/mongoose/models/PricingIdentityMongoose';
import PricingAnonymousLinkMongoose from '../main/repositories/mongoose/models/PricingAnonymousLinkMongoose';
import OrganizationMongoose from '../main/repositories/mongoose/models/OrganizationMongoose';
import NotificationMongoose from '../main/repositories/mongoose/models/NotificationMongoose';
import OrbitToolRunner from '../main/services/orbit/OrbitTools';
import container from '../main/config/container';
import { ANONYMOUS_ANALYTICS_KEYS, ANONYMOUS_PRICING_KEYS, MAX_ANONYMOUS_LINKS_PER_PRICING } from '../main/types/models/PricingAnonymousLink';

dotenv.config();

const NONE = { GET: false, PUT: false, DELETE: false, CREATE: false };
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const label = () => `${Math.floor(Math.random() * 9000) + 1000}.${Math.floor(Math.random() * 900) + 100}.${Math.floor(Math.random() * 90) + 10}`;

/** Status, body and headers of an answer, without the ones that change between two identical requests. */
const comparable = (response: request.Response) => {
  const { date, ...headers } = response.headers;
  const body = Buffer.isBuffer(response.body) ? response.body.toString('utf8') : response.text ?? JSON.stringify(response.body);
  return { status: response.status, body, headers };
};

describe('Anonymous pricing links', { timeout: 60000 }, () => {
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
        if (typeof version.yaml === 'string' && /^static\/(pricings\/uploaded|collections)\//.test(version.yaml)) {
          generatedFilesToDelete.add(path.resolve(process.cwd(), 'public', version.yaml));
        }
        if (version.pricingId) {
          await PricingFollowMongoose.deleteMany({ pricingId: version.pricingId });
          await PricingAnonymousLinkMongoose.deleteMany({ pricingId: version.pricingId });
        }
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

  const newOrganization = async (owner: any, prefix = 'Anonymous') => {
    const organization = await createTestOrganization(owner.token, { displayName: `${prefix} ${randomSuffix()}` });
    organizationsWithData.add(organization.id);
    return organization;
  };

  const publish = async (token: string, organizationId: string, name: string, version: string, options: { private?: boolean; unlisted?: boolean } = {}) => {
    const fixture = await createValidPricingYaml(name, version);
    const call = request(app)
      .post(`${BASE_PATH}/pricings/${organizationId}`)
      .set('Authorization', `Bearer ${token}`)
      .field('private', String(options.private ?? false))
      .field('saasName', name)
      .field('version', version);
    if (options.unlisted !== undefined) call.field('unlisted', String(options.unlisted));
    const response = await call.attach('yaml', fixture.filePath);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body;
  };

  const createApiKey = async (user: any, scopes: Array<{ organizationId: string; scope: string }>) => {
    const response = await request(app)
      .post(`${BASE_PATH}/users/${user.username}/api-keys`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `key ${randomSuffix()}`, scopes });
    expect(response.status).toBe(201);
    return response.body.plainKey as string;
  };

  const as = (call: request.Test, auth?: { token?: string; key?: string }) => {
    if (auth?.token) call.set('Authorization', `Bearer ${auth.token}`);
    if (auth?.key) call.set('x-api-key', auth.key);
    return call;
  };
  const createLink = (versionId: string, auth?: { token?: string; key?: string }) =>
    as(request(app).post(`${BASE_PATH}/pricing-anonymous-links`), auth).send({ versionId });
  const listLinks = (pricingId: string, auth?: { token?: string; key?: string }) =>
    as(request(app).get(`${BASE_PATH}/pricing-anonymous-links?pricingId=${pricingId}`), auth);
  const revokeLink = (linkId: string, auth?: { token?: string; key?: string }) =>
    as(request(app).delete(`${BASE_PATH}/pricing-anonymous-links/${linkId}`), auth);
  const shown = (token: string, auth?: { token?: string; key?: string }) =>
    as(request(app).get(`${BASE_PATH}/anonymous-pricings/${token}`), auth);
  const file = (token: string, auth?: { token?: string; key?: string }) =>
    as(request(app).get(`${BASE_PATH}/anonymous-pricings/${token}/yaml`), auth)
      .buffer(true).parse((res, done) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks))); });
  const publicRoutes = [shown, file];

  const versionOf = async (organizationId: string, slug: string, version: string) =>
    PricingMongoose.findOne({ _organizationId: new mongoose.Types.ObjectId(organizationId), slug, version }).lean() as Promise<any>;

  /** An owner, an organization with a pricing of one version in a collection, and a link to that version. */
  const setup = async (options: { unlisted?: boolean } = { unlisted: true }) => {
    const owner = await newUser('owner');
    const organization = await newOrganization(owner);
    const collection = await createTestCollection({ _organizationId: organization.id, name: `col-${randomSuffix()}` });
    collectionIdsToDelete.add(collection.id);
    const name = `anon-${randomSuffix()}`;
    const versionLabel = label();
    const created = await publish(owner.token, organization.id, name, versionLabel, { unlisted: options.unlisted });
    await request(app).post(`${BASE_PATH}/collections/${organization.id}/${collection.slug}`)
      .set('Authorization', `Bearer ${owner.token}`).send({ pricingSlug: created.slug }).expect(200);
    const version = await versionOf(organization.id, created.slug, versionLabel);
    const link = await createLink(String(version._id), { token: owner.token });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const organizationDoc: any = await OrganizationMongoose.findById(organization.id).lean();
    return {
      owner, organization, organizationDoc, collection, name, slug: created.slug as string, versionLabel, version,
      pricingId: String(version.pricingId), link: link.body,
      url: `${BASE_PATH}/pricings/${organization.id}/${created.slug}`,
    };
  };

  /** Everything that would tell who published the pricing, or lead back to it. */
  const identifying = (f: Awaited<ReturnType<typeof setup>>) => [
    f.organization.id, f.organizationDoc.name, f.organizationDoc.displayName, f.pricingId, String(f.version._id),
    f.collection.id, f.collection.name, f.collection.slug, f.owner.username, f.owner.email, 'static/', 'forkedFrom', 'contentHash',
  ].filter(Boolean).map(String);

  const allKeys = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value).flatMap(([key, child]) => [prefix + key, ...(key === 'analytics' ? [] : allKeys(child, `${prefix}${key}.`))])
      : [];

  describe('What a link shows', () => {
    it('Shows the version through a random token, with a closed list of keys and nothing that names who published it. (CA-12.1, CA-12.2, CA-14.2, CA-16.1-16.4, CA-16.7)', async () => {
      const f = await setup();
      expect(f.link.token).toMatch(TOKEN);
      expect(mongoose.isValidObjectId(f.link.token) && /^[0-9a-f]{24}$/.test(f.link.token)).toBe(false);
      for (const value of [f.pricingId, String(f.version._id), f.organization.id, f.slug]) {
        expect(f.link.token.toLowerCase()).not.toContain(value.toLowerCase());
      }
      expect(f.link).toMatchObject({ versionId: String(f.version._id), version: f.versionLabel, active: true });

      for (const route of publicRoutes) {
        const response = await route(f.link.token);
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
        const headers = JSON.stringify(response.headers);
        for (const value of [f.pricingId, String(f.version._id), f.organization.id]) expect(headers).not.toContain(value);
        expect(headers).not.toMatch(/"[0-9a-f]{24}\.\d+"/);
      }

      const body = (await shown(f.link.token)).body;
      expect(Object.keys(body).sort()).toEqual([...ANONYMOUS_PRICING_KEYS].sort());
      expect(allKeys(body).filter(key => !key.startsWith('analytics'))).toEqual(expect.arrayContaining(['version', 'createdAt', 'yaml']));
      expect(Object.keys(body.analytics).every(key => (ANONYMOUS_ANALYTICS_KEYS as readonly string[]).includes(key))).toBe(true);
      expect(Object.keys(body.analytics).length).toBeGreaterThan(0);
      expect(body.version).toBe(f.versionLabel);
      const text = JSON.stringify(body);
      for (const value of identifying(f)) expect(text, value).not.toContain(value);
      expect(text).not.toContain('/public/pricings/');

      const stored = await fs.readFile(path.resolve(process.cwd(), 'public', f.version.yaml));
      const downloaded = await file(f.link.token);
      expect(Buffer.compare(downloaded.body as Buffer, stored)).toBe(0);
      expect(body.yaml).toBe(stored.toString('utf8'));
      const disposition = String(downloaded.headers['content-disposition']);
      expect(disposition).toContain('attachment');
      for (const value of [f.organization.id, f.slug, f.pricingId, String(f.version._id), f.name]) expect(disposition).not.toContain(value);
    });

    it('Leaves out where a fork came from and a merge that named another pricing. (CA-15.3, CA-16.1, T3)', async () => {
      const source = await setup({ unlisted: false });
      const forker = await newUser('forker');
      const forkName = `fork-${randomSuffix()}`;
      const fork = await request(app).post(`${BASE_PATH}/pricing-forks`).set('Authorization', `Bearer ${forker.token}`).send({
        sourceOrganizationId: source.organization.id, sourceSlug: source.slug, sourceVersion: source.versionLabel,
        targetOrganizationId: forker.personalOrganizationId, name: forkName,
      });
      expect(fork.status).toBe(200);
      const forked: any = await PricingMongoose.findOne({ name: forkName }).lean();
      // A merged version (pull requests) names where it came from; it must not show either.
      await PricingMongoose.collection.updateOne({ _id: forked._id }, { $set: { mergedFrom: { number: 7, prId: new mongoose.Types.ObjectId() } } });
      const link = await createLink(String(forked._id), { token: forker.token });
      expect(link.status).toBe(201);
      const body = (await shown(link.body.token)).body;
      expect(Object.keys(body).sort()).toEqual([...ANONYMOUS_PRICING_KEYS].sort());
      const text = JSON.stringify(body);
      for (const value of [...identifying(source), forker.personalOrganizationId, String(forked.pricingId), 'mergedFrom', forker.username]) {
        expect(text, value).not.toContain(value);
      }
    });

    it('Answers the same to every caller, whatever credentials they send. (CA-16.5, T5)', async () => {
      const f = await setup();
      const other = await newUser('other');
      const keys = {
        all: await createApiKey(f.owner, [{ organizationId: f.organization.id, scope: 'ALL' }]),
        view: await createApiKey(f.owner, [{ organizationId: f.organization.id, scope: 'VIEW' }]),
      };
      const variants: Array<(call: request.Test) => request.Test> = [
        call => call,
        call => call.set('Authorization', `Bearer ${f.owner.token}`),
        call => call.set('Authorization', `Bearer ${other.token}`),
        call => call.set('x-api-key', keys.all),
        call => call.set('x-api-key', keys.view),
        call => call.set('Authorization', 'Bearer not.a.token'),
        call => call.set('Authorization', 'Bearer sph_oat_invalid'),
        call => call.set('Authorization', 'Bearer sph_oid_invalid'),
        call => call.set('Cookie', 'session=whatever'),
      ];
      for (const url of [`${BASE_PATH}/anonymous-pricings/${f.link.token}`, `${BASE_PATH}/anonymous-pricings/${f.link.token}/yaml`,
        `${BASE_PATH}/anonymous-pricings/${'x'.repeat(32)}`]) {
        const baseline = comparable(await request(app).get(url));
        for (const [index, variant] of variants.entries()) {
          expect(comparable(await variant(request(app).get(url))), `${url} variant ${index}`).toEqual(baseline);
        }
      }
    });

    it('Gives two links to the same version two tokens, and creating one leaves the pricing as it was. (CA-12.3, CA-12.5)', async () => {
      const f = await setup();
      const before = (await request(app).get(f.url).set('Authorization', `Bearer ${f.owner.token}`)).headers.etag;
      const second = await createLink(String(f.version._id), { token: f.owner.token });
      expect(second.status).toBe(201);
      expect(second.body.token).not.toBe(f.link.token);
      const after = (await request(app).get(f.url).set('Authorization', `Bearer ${f.owner.token}`)).headers.etag;
      expect(after).toBe(before);
    });

    it('Serves a version uploaded in a collection ZIP, whose file path names the collection, by its token only. (CA-16.7)', async () => {
      const f = await setup();
      const folder = path.resolve(process.cwd(), 'public', 'static', 'collections', f.organization.id, f.collection.name);
      await fs.mkdir(folder, { recursive: true });
      generatedFilesToDelete.add(path.resolve(process.cwd(), 'public', 'static', 'collections', f.organization.id));
      const zipLabel = label();
      const fixture = await createValidPricingYaml(f.name, zipLabel);
      const stored = `static/collections/${f.organization.id}/${f.collection.name}/${zipLabel}.yml`;
      await fs.copyFile(fixture.filePath, path.resolve(process.cwd(), 'public', stored));
      const { _id, __v, addedAt, ...copy } = f.version;
      const [created] = await container.resolve('pricingRepository').create([{ ...copy, version: zipLabel, yaml: stored }]);
      const link = await createLink(String(created._id), { token: f.owner.token });
      expect(link.status).toBe(201);
      const body = (await shown(link.body.token).expect(200)).body;
      expect(body.version).toBe(zipLabel);
      expect(JSON.stringify(body)).not.toContain('static/');
      expect(JSON.stringify(body)).not.toContain(f.collection.name);
    });
  });

  describe('When a link shows nothing', () => {
    it('Answers a token that never existed, a revoked one and a malformed one alike, on every public route. (CA-13.2, CA-17.1, CA-17.5, G1)', async () => {
      const f = await setup();
      const second = (await createLink(String(f.version._id), { token: f.owner.token })).body;
      expect((await revokeLink(second.id, { token: f.owner.token })).status).toBe(204);

      const missing = 'A'.repeat(32);
      const malformed = ['A'.repeat(31), 'A'.repeat(33), 'A'.repeat(1000), `${'A'.repeat(30)}.x`, `${'A'.repeat(29)}%2F..`, `${'A'.repeat(31)}é`];
      for (const route of publicRoutes) {
        const baseline = comparable(await route(missing));
        expect(baseline.status).toBe(404);
        expect(JSON.parse(baseline.body)).toEqual({ error: 'Link not available' });
        // Kept out of caches and search engines also when it shows nothing (CA-16.4).
        expect(baseline.headers['cache-control']).toBe('no-store');
        expect(baseline.headers['x-robots-tag']).toBe('noindex, nofollow');
        expect(baseline.headers['referrer-policy']).toBe('no-referrer');
        expect(comparable(await route(second.token))).toEqual(baseline);
        for (const token of malformed) {
          const response = comparable(await route(encodeURIComponent(token).replace(/%25/g, '%')));
          expect(response.status, token).toBe(404);
          expect(response.body, token).toBe(baseline.body);
        }
      }
      // The other link keeps working.
      await shown(f.link.token).expect(200);
    });

    it('Stops showing a version while it, or the whole pricing, is private and shows it again when it is not, on every public route. (CA-17.4, G4)', async () => {
      const f = await setup();
      const missing = await Promise.all(publicRoutes.map(async route => comparable(await route('B'.repeat(32)))));
      const answersLikeMissing = async (when: string) => {
        for (const [index, route] of publicRoutes.entries()) expect(comparable(await route(f.link.token)), `${when}, route ${index}`).toEqual(missing[index]);
      };
      const showsIt = async (when: string) => {
        for (const [index, route] of publicRoutes.entries()) expect((await route(f.link.token)).status, `${when}, route ${index}`).toBe(200);
      };
      const owner = { Authorization: `Bearer ${f.owner.token}` };

      await request(app).put(`${f.url}/${f.versionLabel}`).set(owner).send({ private: true }).expect(200);
      await answersLikeMissing('version private');
      expect((await listLinks(f.pricingId, { token: f.owner.token })).body.links[0]).toMatchObject({ id: f.link.id, active: false });
      await request(app).put(`${f.url}/${f.versionLabel}`).set(owner).send({ private: false }).expect(200);
      await showsIt('version public again');

      await request(app).put(f.url).set(owner).send({ private: true }).expect(200);
      await answersLikeMissing('pricing private');
      await request(app).put(f.url).set(owner).send({ private: false }).expect(200);
      await showsIt('pricing public again');
    });

    it('Answers alike on every public route and deletes the link when its version, its pricing, its collection or its organization goes. (CA-17.2, G2, G3)', async () => {
      const missingAnswers = await Promise.all(publicRoutes.map(async route => comparable(await route('C'.repeat(32)))));
      const answersLikeMissing = async (token: string, when: string) => {
        for (const [index, route] of publicRoutes.entries()) expect(comparable(await route(token)), `${when}, route ${index}`).toEqual(missingAnswers[index]);
      };

      const versionGone = await setup();
      const other = await publish(versionGone.owner.token, versionGone.organization.id, versionGone.name, label());
      expect(other.slug).toBe(versionGone.slug);
      await request(app).delete(`${versionGone.url}/${versionGone.versionLabel}?collectionSlug=${versionGone.collection.slug}`).set('Authorization', `Bearer ${versionGone.owner.token}`).expect(200);
      await answersLikeMissing(versionGone.link.token, 'version deleted');
      expect(await PricingAnonymousLinkMongoose.exists({ _id: versionGone.link.id })).toBeNull();

      const pricingGone = await setup();
      await request(app).delete(`${pricingGone.url}?collectionSlug=${pricingGone.collection.slug}`).set('Authorization', `Bearer ${pricingGone.owner.token}`).expect(200);
      expect((await PricingIdentityMongoose.findById(pricingGone.pricingId).lean() as any)?.deleted).toBe(true);
      await answersLikeMissing(pricingGone.link.token, 'pricing deleted');
      expect(await PricingAnonymousLinkMongoose.exists({ _id: pricingGone.link.id })).toBeNull();

      const identityFlagged = await setup();
      await PricingIdentityMongoose.updateOne({ _id: identityFlagged.pricingId }, { $set: { deleted: true } });
      await answersLikeMissing(identityFlagged.link.token, 'identity flagged as deleted');

      // A collection deleted with its pricings goes through the same delete hook as an organization.
      const collectionGone = await setup();
      await request(app).delete(`${BASE_PATH}/collections/${collectionGone.organization.id}/${collectionGone.collection.slug}?cascade=true`)
        .set('Authorization', `Bearer ${collectionGone.owner.token}`).expect(200);
      expect(await PricingMongoose.exists({ _id: collectionGone.version._id })).toBeNull();
      await answersLikeMissing(collectionGone.link.token, 'collection deleted');
      expect(await PricingAnonymousLinkMongoose.exists({ _id: collectionGone.link.id })).toBeNull();

      const organizationGone = await setup();
      await request(app).delete(`${BASE_PATH}/orgs/${organizationGone.organization.id}`).set('Authorization', `Bearer ${organizationGone.owner.token}`).expect(200);
      orgsToDelete.delete(organizationGone.organization.id);
      expect(await PricingMongoose.exists({ _id: organizationGone.version._id })).toBeNull();
      await answersLikeMissing(organizationGone.link.token, 'organization deleted');
      expect(await PricingAnonymousLinkMongoose.exists({ _id: organizationGone.link.id })).toBeNull();

      const fileGone = await setup();
      await fs.rm(path.resolve(process.cwd(), 'public', fileGone.version.yaml), { force: true });
      await answersLikeMissing(fileGone.link.token, 'file gone');
    });

    it('Never shows a pricing deleted and created again with the same name and version through its old token. (CA-17.3, T19)', async () => {
      const f = await setup();
      await request(app).delete(`${f.url}?collectionSlug=${f.collection.slug}`).set('Authorization', `Bearer ${f.owner.token}`).expect(200);
      await publish(f.owner.token, f.organization.id, f.name, f.versionLabel, { unlisted: true });
      await shown(f.link.token).expect(404);
    });

    it('Never releases what a revocation, a visibility change, a deletion or a new file took away while the file was being read. (CA-17.7, G6)', async () => {
      const service: any = container.resolve('pricingAnonymousLinkService');
      const original = service.readFile;
      const changes: Array<[string, (f: Awaited<ReturnType<typeof setup>>) => Promise<unknown>]> = [
        ['revoked', f => PricingAnonymousLinkMongoose.deleteOne({ _id: f.link.id })],
        ['made private', f => PricingMongoose.collection.updateOne({ _id: f.version._id }, { $set: { private: true } })],
        ['deleted', f => PricingMongoose.collection.deleteOne({ _id: f.version._id })],
        ['given another file', f => PricingMongoose.collection.updateOne({ _id: f.version._id }, { $set: { yaml: `${f.version.yaml}.moved` } })],
      ];
      try {
        for (const [name, change] of changes) {
          const f = await setup();
          let release!: () => void;
          let reached!: () => void;
          const paused = new Promise<void>(resolve => { release = resolve; });
          const reading = new Promise<void>(resolve => { reached = resolve; });
          service.readFile = async (stored: string) => {
            const bytes = await original(stored);
            reached();
            await paused;
            return bytes;
          };
          const pending = service.resolve(f.link.token);
          await reading;
          await change(f);
          release();
          expect(await pending, name).toBeNull();
          service.readFile = original;
        }
      } finally {
        service.readFile = original;
      }
    });
  });

  describe('A link follows its version through changes to the pricing', () => {
    it('Keeps showing the same version after a rename, a move, a visibility change, a new version and a new parent organization. (CA-18)', async () => {
      const f = await setup();
      const renamed = `renamed-${randomSuffix()}`;
      await request(app).put(f.url).set('Authorization', `Bearer ${f.owner.token}`).send({ name: renamed }).expect(200);
      let body = (await shown(f.link.token).expect(200)).body;
      expect(body.version).toBe(f.versionLabel);
      expect(body.yaml).toContain(`saasName: ${renamed}`);

      const slug = (await PricingMongoose.findById(f.version._id).lean() as any).slug;
      const url = `${BASE_PATH}/pricings/${f.organization.id}/${slug}`;
      const target = await createTestCollection({ _organizationId: f.organization.id, name: `col2-${randomSuffix()}` });
      collectionIdsToDelete.add(target.id);
      await request(app).post(`${BASE_PATH}/collections/${f.organization.id}/${target.slug}`)
        .set('Authorization', `Bearer ${f.owner.token}`).send({ pricingSlug: slug });
      expect((await shown(f.link.token).expect(200)).body.version).toBe(f.versionLabel);

      for (const unlisted of [false, true, false]) {
        await request(app).put(url).set('Authorization', `Bearer ${f.owner.token}`).send({ unlisted }).expect(200);
        expect((await shown(f.link.token).expect(200)).body.version).toBe(f.versionLabel);
      }

      await publish(f.owner.token, f.organization.id, renamed, label());
      body = (await shown(f.link.token).expect(200)).body;
      expect(body.version).toBe(f.versionLabel);

      const parent = await newOrganization(f.owner, 'Parent');
      await request(app).put(`${BASE_PATH}/orgs/${f.organization.id}/parent`)
        .set('Authorization', `Bearer ${f.owner.token}`).send({ parentId: parent.id }).expect(200);
      expect(String((await OrganizationMongoose.findById(f.organization.id).lean() as any)._parentId)).toBe(parent.id);
      expect((await shown(f.link.token).expect(200)).body.version).toBe(f.versionLabel);
    });
  });

  describe('Managing links', () => {
    it('Lets only who may edit the pricing create, list and revoke its links. (CA-12.4, CA-13.3, CA-13.4, T6)', async () => {
      const f = await setup();
      const member = await newUser('member');
      await createMembership(member.id, f.organization.id, 'MEMBER');
      await createEntityScopedPermission(member.id, f.organization.id, f.slug, 'pricing', { ...NONE, GET: true });
      const outsider = await newUser('outsider');
      const viewKey = await createApiKey(f.owner, [{ organizationId: f.organization.id, scope: 'VIEW' }]);
      const versionId = String(f.version._id);
      const count = () => PricingAnonymousLinkMongoose.countDocuments({ pricingId: f.pricingId });
      const before = await count();

      expect((await createLink(versionId)).status).toBe(401);
      expect((await createLink(versionId, { token: member.token })).status).toBe(403);
      expect((await createLink(versionId, { token: outsider.token })).status).toBe(403);
      expect((await createLink(versionId, { key: viewKey })).status).toBe(403);
      expect(await count()).toBe(before);

      expect((await listLinks(f.pricingId)).status).toBe(401);
      expect((await listLinks(f.pricingId, { token: member.token })).status).toBe(403);
      expect((await listLinks(f.pricingId, { key: viewKey })).status).toBe(403);

      expect((await revokeLink(f.link.id)).status).toBe(401);
      expect((await revokeLink(f.link.id, { token: member.token })).status).toBe(404);
      expect((await revokeLink(f.link.id, { key: viewKey })).status).toBe(404);
      await shown(f.link.token).expect(200);

      // A link of another pricing, with PUT on one's own.
      const elsewhere = await setup();
      expect((await revokeLink(elsewhere.link.id, { token: f.owner.token })).status).toBe(404);
      await shown(elsewhere.link.token).expect(200);

      // PUT through the collection is enough, as for the visibility.
      await createEntityScopedPermission(member.id, f.organization.id, f.collection.slug, 'collection', { ...NONE, GET: true, PUT: true });
      expect((await createLink(versionId, { token: member.token })).status).toBe(201);
      expect((await listLinks(f.pricingId, { token: member.token })).status).toBe(200);

      // A key of the owner with every scope, but over another organization, may not.
      const elsewhereKey = await createApiKey(f.owner, [{ organizationId: f.owner.personalOrganizationId, scope: 'ALL' }]);
      expect((await createLink(versionId, { key: elsewhereKey })).status).toBe(403);
      expect((await listLinks(f.pricingId, { key: elsewhereKey })).status).toBe(403);
      expect((await revokeLink(f.link.id, { key: elsewhereKey })).status).toBe(404);
      await shown(f.link.token).expect(200);

      // A MANAGEMENT key of the owner may.
      const managementKey = await createApiKey(f.owner, [{ organizationId: f.organization.id, scope: 'MANAGEMENT' }]);
      expect((await listLinks(f.pricingId, { key: managementKey })).status).toBe(200);
      expect((await createLink(versionId, { key: managementKey })).status).toBe(201);
    });

    it('Takes back a link whose version was deleted while it was being created, so it never holds a slot unseen. (M1)', async () => {
      const f = await setup();
      const second = await publish(f.owner.token, f.organization.id, f.name, label());
      expect(second.slug).toBe(f.slug);
      const target = await versionOf(f.organization.id, f.slug, (await PricingMongoose.findOne({ pricingId: f.pricingId, _id: { $ne: f.version._id } }).lean() as any).version);
      const repository: any = (container.resolve('pricingAnonymousLinkService') as any).repository;
      const original = repository.create;
      // The deletion lands after the version was read and its cleanup runs before the insert.
      repository.create = async (data: unknown) => {
        await PricingMongoose.collection.deleteOne({ _id: target._id });
        return original.call(repository, data);
      };
      try {
        const response = await createLink(String(target._id), { token: f.owner.token });
        expect(response.status).toBe(404);
      } finally {
        repository.create = original;
      }
      expect(await PricingAnonymousLinkMongoose.countDocuments({ pricingId: f.pricingId })).toBe(1);
      const listed = (await listLinks(f.pricingId, { token: f.owner.token }).expect(200)).body.links;
      expect(listed.map((link: any) => link.id)).toEqual([f.link.id]);
    });

    it('Takes back a link whose version was made private while it was being created, and answers 409. (N7)', async () => {
      const f = await setup();
      const repository: any = (container.resolve('pricingAnonymousLinkService') as any).repository;
      const original = repository.create;
      // The version turns private after it was read as public, before the insert.
      repository.create = async (data: unknown) => {
        await PricingMongoose.collection.updateOne({ _id: f.version._id }, { $set: { private: true } });
        return original.call(repository, data);
      };
      try {
        const response = await createLink(String(f.version._id), { token: f.owner.token });
        expect(response.status).toBe(409);
        expect(response.body.error).toMatch(/private version/);
      } finally {
        repository.create = original;
      }
      expect(await PricingAnonymousLinkMongoose.countDocuments({ pricingId: f.pricingId })).toBe(1);
    });

    it('Answers a pricing the caller may not read like a missing one. (CA-12.4, CA-13.4)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const outsider = await newUser('outsider');
      const created = await publish(owner.token, organization.id, `hidden-${randomSuffix()}`, label(), { private: true });
      const version = await versionOf(organization.id, created.slug, created.version);
      expect((await createLink(String(version._id), { token: outsider.token })).status).toBe(404);
      expect((await listLinks(String(version.pricingId), { token: outsider.token })).status).toBe(404);
      expect((await listLinks('not-an-id', { token: owner.token })).status).toBe(404);
      expect((await createLink('not-an-id', { token: owner.token })).status).toBe(404);
    });

    it('Refuses a link to a private version, even to its owner. (CA-11.3, A4)', async () => {
      const owner = await newUser('owner');
      const organization = await newOrganization(owner);
      const created = await publish(owner.token, organization.id, `private-${randomSuffix()}`, label(), { private: true });
      const version = await versionOf(organization.id, created.slug, created.version);
      const response = await createLink(String(version._id), { token: owner.token });
      expect(response.status).toBe(409);
      expect(await PricingAnonymousLinkMongoose.countDocuments({ pricingId: version.pricingId })).toBe(0);
    });

    it(`Keeps a pricing to ${MAX_ANONYMOUS_LINKS_PER_PRICING} links. (T20)`, async () => {
      const f = await setup();
      for (let created = 1; created < MAX_ANONYMOUS_LINKS_PER_PRICING; created++) {
        expect((await createLink(String(f.version._id), { token: f.owner.token })).status).toBe(201);
      }
      const extra = await createLink(String(f.version._id), { token: f.owner.token });
      expect(extra.status).toBe(409);
      const listed = await listLinks(f.pricingId, { token: f.owner.token }).expect(200);
      expect(listed.body.links).toHaveLength(MAX_ANONYMOUS_LINKS_PER_PRICING);
      expect(listed.body.limit).toBe(MAX_ANONYMOUS_LINKS_PER_PRICING);
    });

    it('Lists the links newest first with their version, date and token, and takes no token from the client. (CA-13.1, T7)', async () => {
      const f = await setup();
      const chosen = 'Z'.repeat(32);
      const second = await as(request(app).post(`${BASE_PATH}/pricing-anonymous-links`), { token: f.owner.token })
        .send({ versionId: String(f.version._id), token: chosen });
      expect(second.status).toBe(201);
      expect(second.body.token).not.toBe(chosen);
      const listed = (await listLinks(f.pricingId, { token: f.owner.token }).expect(200)).body.links;
      expect(listed.map((link: any) => link.id)).toEqual([second.body.id, f.link.id]);
      expect(listed[1]).toMatchObject({ token: f.link.token, version: f.versionLabel, versionId: String(f.version._id), active: true });
      expect(listed[1].createdAt).toBeDefined();
    });

    it('Takes credentials in a header only: a cookie or a cross-site form gets nothing done. (T8, T9)', async () => {
      const f = await setup();
      const withCookie = await request(app).post(`${BASE_PATH}/pricing-anonymous-links`).set('Cookie', `token=${f.owner.token}`).send({ versionId: String(f.version._id) });
      expect(withCookie.status).toBe(401);
      const form = await request(app).post(`${BASE_PATH}/pricing-anonymous-links`).type('form').send({ versionId: String(f.version._id) });
      expect(form.status).toBe(401);
    });

    it('Never puts a token in the pricing, its manifest, its graph, notifications or ORBIT and MCP answers. (CA-13.5, CA-23.4)', async () => {
      const f = await setup();
      const follower = await newUser('follower');
      await request(app).put(`${BASE_PATH}/pricing-follows/${f.organization.id}/${f.slug}`).set('Authorization', `Bearer ${follower.token}`).expect(200);
      await publish(f.owner.token, f.organization.id, f.name, label());
      const runner = new OrbitToolRunner();
      const context = {
        actor: { id: f.owner.id, username: f.owner.username, role: 'USER' as const },
        conversation: { id: new mongoose.Types.ObjectId().toString(), userId: f.owner.id, title: '', messages: [], attachments: [] } as any,
        onPlan: () => {},
      };
      const key = await createApiKey(f.owner, [{ organizationId: f.organization.id, scope: 'ALL' }]);
      const mcp = await request(app).post(`${BASE_PATH}/orbit/mcp`).set('x-api-key', key).set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_pricings', arguments: { query: f.name } } });
      const answers = [
        (await request(app).get(f.url).set('Authorization', `Bearer ${f.owner.token}`)).body,
        (await request(app).get(`${BASE_PATH}/public/pricings/${f.pricingId}`)).body,
        (await request(app).get(`${BASE_PATH}/pricing-graphs/${f.organization.id}/${f.slug}`)).body,
        await NotificationMongoose.find({ _userId: follower.id }).lean(),
        await runner.runParsed('get_pricing', { organizationId: f.organization.id, pricing: f.slug }, context),
        await runner.runParsed('search_pricings', { query: f.name }, context),
        await runner.runParsed('list_resources', { organizationId: f.organization.id }, context),
        await runner.runParsed('who_can_access', { organizationId: f.organization.id, resource: f.slug, type: 'pricing' }, context),
        mcp.body,
      ];
      for (const [index, answer] of answers.entries()) {
        expect(JSON.stringify(answer), `answer ${index}`).not.toContain(f.link.token);
      }
    });
  });
});
