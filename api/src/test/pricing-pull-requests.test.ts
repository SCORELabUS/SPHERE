import { createHash } from 'crypto';
import dotenv from 'dotenv';
import { promises as fsp, readFileSync } from 'fs';
import yaml from 'js-yaml';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { shutdownApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { BASE_PATH } from './utils/config/variables';
import { randomSuffix } from './utils/helpers';
import { createAndLoginUser, deleteTestUser } from './utils/users/userTestUtils';
import { createMembership, createTestOrganization } from './utils/organizations';
import { createEntityPermission } from './utils/permissions/permissionTestUtils';
import { forkPricingIntoOrganization } from './utils/pricings/pricingTestUtils';
import appContainer from '../main/config/container';
import { getMongoDBConnectionURI } from '../main/config/mongoose';
import { seedDatabase } from '../main/database/seeders/mongo/seeder';
import { up } from '../main/migrations/mongo/20261111120000-create-pricing-pull-requests';
import EntityPermissionMongoose from '../main/repositories/mongoose/models/EntityPermissionMongoose';
import OrganizationMembershipMongoose from '../main/repositories/mongoose/models/OrganizationMembershipMongoose';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import PricingIdentityMongoose from '../main/repositories/mongoose/models/PricingIdentityMongoose';
import PricingPullRequestMongoose from '../main/repositories/mongoose/models/PricingPullRequestMongoose';
import { OAuthGrant, OAuthToken } from '../main/repositories/mongoose/models/OAuthMongoose';
import { oauthResource } from '../main/services/OAuthService';
import PricingPullRequestRepository, {
  MERGE_LOCK_MS,
  duplicateKeyFields,
} from '../main/repositories/mongoose/PricingPullRequestRepository';
import { NewPricingPullRequest } from '../main/types/models/PricingPullRequest';
import { requirePricingFile } from '../main/utils/pricing-files';
import { mergePricingDocs } from '../main/utils/pricing-merge';
import { dumpPricingDoc, loadPricingDoc, STORED_PRICING_MAX_BYTES, upgradeToLatestSyntax } from '../main/utils/pricing-syntax';

// The seeder's data import is replaced, so seeding here only runs the steps after it.
vi.mock('mongo-seeding', () => ({
  Seeder: class {
    readCollectionsFromPath() {
      return [];
    }
    async import() {
      return undefined;
    }
  },
}));

// Counted, to see how often the listings compute a merge (the service imports the same module).
vi.mock('../main/utils/pricing-merge', async importOriginal => {
  const actual = await importOriginal<typeof import('../main/utils/pricing-merge')>();
  return { ...actual, mergePricingDocs: vi.fn(actual.mergePricingDocs) };
});

dotenv.config();

const COLLECTION = 'pricingPullRequests';
const HOUR = 60 * 60 * 1000;
const newId = () => new mongoose.Types.ObjectId().toString();
const PULL_REQUESTS = `${BASE_PATH}/pricing-pull-requests`;

/** The petclinic template in the latest syntax, which the pricings of these tests start from. */
const TEMPLATE = upgradeToLatestSyntax(
  loadPricingDoc(
    readFileSync(path.resolve(process.cwd(), 'public', 'static', 'pricings', 'templates', 'petclinic.yml'), 'utf8'),
    STORED_PRICING_MAX_BYTES
  )
).doc;

type PricingChange = (doc: any) => void;

/** A pricing YAML in the latest syntax: the template with `change` applied. */
function pricingYaml(name: string, version: string, change?: PricingChange, createdAt = new Date().toISOString().slice(0, 10)) {
  const doc: any = structuredClone(TEMPLATE);
  doc.saasName = name;
  doc.version = version;
  doc.createdAt = createdAt;
  change?.(doc);
  return dumpPricingDoc(doc);
}

/** What every version after the first one of these pricings changes. */
const V2: PricingChange = doc => {
  doc.plans.BASIC.price = 1;
};
const both = (...changes: PricingChange[]): PricingChange => doc => changes.forEach(change => change(doc));
const goldAt = (price: number): PricingChange => doc => {
  doc.plans.GOLD.price = price;
};
const goldAtNormalized = (doc: any, price: number) => {
  const copy = structuredClone(doc);
  copy.plans.GOLD.price = price;
  return copy;
};
const platinumAt = (price: number): PricingChange => doc => {
  doc.plans.PLATINUM.price = price;
};
/** What only the private version v3 has: unique enough to be searched for in every answer. */
const V3_ONLY: PricingChange = doc => {
  doc.plans.GOLD.price = 987.65;
  doc.features['zz-v3-only'] = {
    description: 'Only in the private version',
    valueType: 'BOOLEAN',
    defaultValue: false,
    expression: "pricingContext['features']['zz-v3-only']",
    type: 'DOMAIN',
  };
  doc.plans.GOLD.features = { ...doc.plans.GOLD.features, 'zz-v3-only': { value: true } };
};
const V3_CREATED_AT = '2011-11-11';

describe('Pricing pull requests', () => {
  const repository: PricingPullRequestRepository = new PricingPullRequestRepository();
  const pricingIds = new Set<string>();
  const usersToDelete: Set<string> = testContainer.resolve('usersToDelete');
  const pricingsToDelete: Set<string> = testContainer.resolve('pricingsToDelete');
  const generatedFilesToDelete: Set<string> = testContainer.resolve('generatedFilesToDelete');
  const membershipsToDelete: Set<string> = testContainer.resolve('membershipsToDelete');
  const permissionsToDelete = new Set<string>();
  const app = () => testContainer.resolve('app');

  beforeAll(async () => {
    testContainer.resolve('app');
    // The model builds its indexes once when it is compiled; wait for that so the
    // tests below only see what the migration creates.
    await PricingPullRequestMongoose.init();
  });

  afterEach(async () => {
    const ids = [...pricingIds].map(id => new mongoose.Types.ObjectId(id));
    await PricingPullRequestMongoose.deleteMany({ pricingId: { $in: ids } });
    await PricingMongoose.collection.deleteMany({ pricingId: { $in: ids } });
    await PricingIdentityMongoose.deleteMany({ _id: { $in: ids } });
    pricingIds.clear();
  });

  afterAll(async () => {
    // Deleting the versions takes their pull requests with them.
    await PricingMongoose.deleteMany({ _id: { $in: [...pricingsToDelete] } });
    pricingsToDelete.clear();
    for (const file of generatedFilesToDelete) await fsp.rm(file, { force: true });
    generatedFilesToDelete.clear();
    for (const username of usersToDelete) await deleteTestUser(username);
    usersToDelete.clear();
    await OrganizationMembershipMongoose.deleteMany({ _id: { $in: [...membershipsToDelete] } });
    membershipsToDelete.clear();
    await EntityPermissionMongoose.deleteMany({ _id: { $in: [...permissionsToDelete] } });
    await shutdownApp();
  });

  /** A pricing identity id that afterEach cleans up. */
  const trackedPricingId = () => {
    const id = newId();
    pricingIds.add(id);
    return id;
  };

  const pullRequest = (pricingId: string, overrides: Partial<NewPricingPullRequest> = {}): NewPricingPullRequest => ({
    pricingId,
    title: 'Raise the price of PRO',
    description: '',
    authorId: newId(),
    base: { versionId: newId(), version: '1.0', yaml: 'saasName: Base\n' },
    proposed: { yaml: 'saasName: Proposed\n', suggestedVersion: '1.1' },
    ...overrides,
  });

  const fromFork = (forkPricingId: string) => ({
    pricingId: forkPricingId,
    versionId: newId(),
    version: '2.0',
    baseVersionId: newId(),
    edited: false,
  });

  async function dropCollection() {
    await mongoose.connection.db!.collection(COLLECTION).drop().catch(() => undefined);
  }

  async function indexesOf() {
    const indexes = await mongoose.connection.db!.collection(COLLECTION).indexes();
    return indexes
      .filter(index => index.name !== '_id_')
      .map(index => ({
        key: index.key,
        unique: index.unique ?? false,
        partialFilterExpression: index.partialFilterExpression ?? null,
      }));
  }

  const EXPECTED_INDEXES = [
    { key: { pricingId: 1, number: 1 }, unique: true, partialFilterExpression: null },
    { key: { pricingId: 1, status: 1, updatedAt: -1 }, unique: false, partialFilterExpression: null },
    { key: { authorId: 1, createdAt: -1 }, unique: false, partialFilterExpression: null },
    {
      key: { pricingId: 1, 'origin.pricingId': 1 },
      unique: true,
      partialFilterExpression: { status: 'open', 'origin.pricingId': { $exists: true } },
    },
  ];

  describe('Collection, migration and seeder', { timeout: 30000 }, () => {
    it('The migration creates the four indexes and can run twice.', async () => {
      await dropCollection();

      await up(mongoose.connection);
      await up(mongoose.connection);

      expect(await indexesOf()).toEqual(EXPECTED_INDEXES);
    });

    it('The seeder creates the indexed collection and leaves it empty.', async () => {
      await dropCollection();

      await seedDatabase();

      expect(await indexesOf()).toEqual(EXPECTED_INDEXES);
      expect(await mongoose.connection.db!.collection(COLLECTION).countDocuments()).toBe(0);
    });
  });

  describe('Repository', { timeout: 30000 }, () => {
    // The numbering and the one open pull request per fork rely on the unique indexes.
    beforeAll(async () => {
      await up(mongoose.connection);
    });

    it('Numbers the pull requests of each pricing from 1, also when they are created at once.', async () => {
      const pricingId = trackedPricingId();
      const otherPricingId = trackedPricingId();

      const created = await Promise.all([1, 2, 3].map(() => repository.create(pullRequest(pricingId))));
      const other = await repository.create(pullRequest(otherPricingId));

      expect(created.map(pr => pr.number).sort()).toEqual([1, 2, 3]);
      expect(other.number).toBe(1);
      expect(created[0]).toMatchObject({ status: 'open', proposalRevision: 1, pricingId });
    });

    it('Refuses a second open pull request from the same fork, and names the index it broke.', async () => {
      const pricingId = trackedPricingId();
      const origin = fromFork(newId());
      const first = await repository.create(pullRequest(pricingId, { origin }));

      const error = await repository.create(pullRequest(pricingId, { origin })).catch(err => err);
      expect(duplicateKeyFields(error)).toEqual(['pricingId', 'origin.pricingId']);
      expect(await repository.findOpenFromFork(pricingId, origin.pricingId)).toMatchObject({ id: first.id });

      await repository.close(first.id, { byId: first.authorId, at: new Date(), kind: 'withdrawn' });
      const second = await repository.create(pullRequest(pricingId, { origin }));
      expect(second.number).toBe(2);
      expect(await repository.findOpenFromFork(pricingId, origin.pricingId)).toMatchObject({ id: second.id });
    });

    it('Updates an open pull request only at the expected revision, and only a new proposal moves it on.', async () => {
      const created = await repository.create(pullRequest(trackedPricingId()));

      expect(await repository.updateOpen(created.id, 2, { title: 'Stale' })).toBeNull();

      const retitled = await repository.updateOpen(created.id, 1, { title: 'Lower the price of PRO' });
      expect(retitled).toMatchObject({ title: 'Lower the price of PRO', proposalRevision: 1 });

      const proposed = await repository.updateOpen(created.id, 1, {
        proposed: { yaml: 'saasName: Again\n', suggestedVersion: '1.2' },
      });
      expect(proposed).toMatchObject({ proposalRevision: 2, proposed: { yaml: 'saasName: Again\n' } });
    });

    it('Marks the origin of a fork proposal as edited.', async () => {
      const created = await repository.create(pullRequest(trackedPricingId(), { origin: fromFork(newId()) }));

      const edited = await repository.updateOpen(created.id, 1, {
        proposed: { yaml: 'saasName: Edited\n', suggestedVersion: '1.1' },
        originEdited: true,
      });

      expect(edited?.origin).toMatchObject({ pricingId: created.origin!.pricingId, edited: true });
    });

    it('A merge reservation holds off changes, other merges and closing until it lapses.', async () => {
      const created = await repository.create(pullRequest(trackedPricingId()));
      const merger = newId();
      const now = new Date();

      const lock = await repository.reserveForMerge(created.id, 1, merger, now);
      expect(lock).toMatchObject({ byId: merger, revision: 1 });
      expect(await repository.reserveForMerge(created.id, 1, merger, now)).toBeNull();
      expect(await repository.updateOpen(created.id, 1, { title: 'During the merge' }, now)).toBeNull();
      expect(await repository.close(created.id, { byId: created.authorId, at: now, kind: 'withdrawn' }, now)).toBeNull();

      const later = new Date(now.getTime() + MERGE_LOCK_MS + 1000);
      const updated = await repository.updateOpen(created.id, 1, { title: 'After it lapsed' }, later);
      expect(updated?.title).toBe('After it lapsed');
      expect(updated?.mergeLock).toBeUndefined();
    });

    it('Reserves only the revision that was reviewed.', async () => {
      const created = await repository.create(pullRequest(trackedPricingId()));
      await repository.updateOpen(created.id, 1, { proposed: { yaml: 'saasName: New\n', suggestedVersion: '1.1' } });

      expect(await repository.reserveForMerge(created.id, 1, newId())).toBeNull();
      expect(await repository.reserveForMerge(created.id, 2, newId())).not.toBeNull();
    });

    it('Only the merge holding the reservation marks the pull request merged.', async () => {
      const created = await repository.create(pullRequest(trackedPricingId()));
      const merger = newId();
      const lock = await repository.reserveForMerge(created.id, 1, merger);
      const merged = { byId: merger, at: new Date(), versionId: newId(), version: '1.1', proposalRevision: 1 };

      expect(await repository.markMerged(created.id, 'another-lock', merged)).toBeNull();

      const done = await repository.markMerged(created.id, lock!.id, merged);
      expect(done).toMatchObject({ status: 'merged', merged: { versionId: merged.versionId, proposalRevision: 1 } });
      expect(done?.mergeLock).toBeUndefined();
      expect(await repository.close(created.id, { byId: merger, at: new Date(), kind: 'rejected' })).toBeNull();
    });

    it('A released reservation lets the pull request be closed.', async () => {
      const created = await repository.create(pullRequest(trackedPricingId()));
      const lock = await repository.reserveForMerge(created.id, 1, newId());

      expect(await repository.releaseMerge(created.id, 'another-lock')).toBe(false);
      expect(await repository.releaseMerge(created.id, lock!.id)).toBe(true);

      const closed = await repository.close(created.id, {
        byId: created.authorId, at: new Date(), kind: 'withdrawn', reason: 'Not needed',
      });
      expect(closed).toMatchObject({ status: 'closed', closed: { kind: 'withdrawn', reason: 'Not needed' } });
    });

    it('Records one round of notifications per period.', async () => {
      const created = await repository.create(pullRequest(trackedPricingId()));
      const now = new Date();
      const dayBefore = new Date(now.getTime() - 24 * HOUR);

      expect(await repository.touchNotified(created.id, dayBefore, now)).toBe(true);
      expect(await repository.touchNotified(created.id, dayBefore, now)).toBe(false);

      const nextDay = new Date(now.getTime() + 25 * HOUR);
      expect(await repository.touchNotified(created.id, new Date(nextDay.getTime() - 24 * HOUR), nextDay)).toBe(true);
    });

    it('Lists a page of the pull requests of a pricing, or of one author, with their counts.', async () => {
      const pricingId = trackedPricingId();
      const author = newId();
      const mine = await repository.create(pullRequest(pricingId, { authorId: author }));
      const theirs = await repository.create(pullRequest(pricingId));
      const mineClosed = await repository.create(pullRequest(pricingId, { authorId: author }));
      await repository.close(mineClosed.id, { byId: author, at: new Date(), kind: 'withdrawn' });
      // The oldest one was updated last.
      const now = Date.now();
      const updatedAt = [[theirs.id, 3], [mineClosed.id, 2], [mine.id, 1]] as const;
      for (const [id, hoursAgo] of updatedAt) {
        await PricingPullRequestMongoose.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(id) },
          { $set: { updatedAt: new Date(now - hoursAgo * HOUR) } }
        );
      }

      const all = await repository.list({ pricingId }, 1, 2);
      expect(all.items.map(pr => pr.id)).toEqual([mine.id, mineClosed.id]);
      expect(all.total).toBe(3);
      expect(all.counts).toEqual({ open: 2, merged: 0, closed: 1 });
      expect((await repository.list({ pricingId }, 2, 2)).items.map(pr => pr.id)).toEqual([theirs.id]);

      const authorOpen = await repository.list({ pricingId, authorId: author, status: 'open' }, 1, 20);
      expect(authorOpen.items.map(pr => pr.id)).toEqual([mine.id]);
      expect(authorOpen.total).toBe(1);
      expect(authorOpen.counts).toEqual({ open: 1, merged: 0, closed: 1 });

      expect(await repository.countOpen(pricingId)).toBe(2);
      expect(await repository.countOpen(pricingId, author)).toBe(1);
      expect(await repository.countCreatedSince(author, new Date(Date.now() - HOUR))).toBe(2);
      expect(await repository.countCreatedSince(author, new Date(Date.now() + HOUR))).toBe(0);
    });

    it('Reads a pull request by id, and answers null to an invalid or unknown id.', async () => {
      const created = await repository.create(pullRequest(trackedPricingId(), { origin: fromFork(newId()) }));

      expect(await repository.findById(created.id)).toEqual(created);
      expect(await repository.findById('not-an-id')).toBeNull();
      expect(await repository.findById(newId())).toBeNull();
    });
  });

  describe('Deleting the pricing', { timeout: 30000 }, () => {
    /** A pricing identity with `versions` versions stored straight in the database. */
    async function pricingWithVersions(versions: number) {
      const pricingId = trackedPricingId();
      const name = `pr_cascade_${randomSuffix()}`;
      const organizationId = new mongoose.Types.ObjectId();
      await PricingIdentityMongoose.create({ _id: pricingId, name, slug: name, _organizationId: organizationId });
      const versionIds: string[] = [];
      for (let index = 1; index <= versions; index++) {
        const version = await PricingMongoose.create({
          pricingId, name, _organizationId: organizationId, version: `${index}.0`,
          createdAt: new Date(), currency: 'USD', yaml: `static/pricings/uploaded/${name}-${index}.yml`,
        });
        versionIds.push(String(version._id));
      }
      return { pricingId, versionIds };
    }

    const countOf = (pricingId: string) =>
      PricingPullRequestMongoose.countDocuments({ pricingId: new mongoose.Types.ObjectId(pricingId) });

    it('Deleting its last version deletes its pull requests, and only then.', async () => {
      const { pricingId, versionIds } = await pricingWithVersions(2);
      const other = await pricingWithVersions(1);
      await repository.create(pullRequest(pricingId));
      await repository.create(pullRequest(pricingId));
      await repository.create(pullRequest(other.pricingId));

      await PricingMongoose.deleteOne({ _id: versionIds[0] });
      expect(await countOf(pricingId)).toBe(2);

      await PricingMongoose.deleteOne({ _id: versionIds[1] });
      expect(await countOf(pricingId)).toBe(0);
      expect(await countOf(other.pricingId)).toBe(1);
    });

    it('Deleting all its versions at once deletes its pull requests.', async () => {
      const { pricingId } = await pricingWithVersions(2);
      await repository.create(pullRequest(pricingId));

      await PricingMongoose.deleteMany({ pricingId: new mongoose.Types.ObjectId(pricingId) });

      expect(await countOf(pricingId)).toBe(0);
      expect((await PricingIdentityMongoose.findById(pricingId).lean())?.deleted).toBe(true);
    });

    it('A connection that does not know the model (a migration\'s) deletes versions and leaves pull requests alone.', async () => {
      const { pricingId, versionIds } = await pricingWithVersions(1);
      await repository.create(pullRequest(pricingId));
      const connection = await mongoose.createConnection(getMongoDBConnectionURI()).asPromise();
      try {
        const Pricing = connection.model('Pricing', PricingMongoose.schema, 'pricings');

        await Pricing.deleteOne({ _id: versionIds[0] });

        expect(await Pricing.countDocuments({ _id: versionIds[0] })).toBe(0);
        expect(await countOf(pricingId)).toBe(1);
      } finally {
        await connection.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // The API: helpers
  // ---------------------------------------------------------------------------

  type User = Awaited<ReturnType<typeof createAndLoginUser>>['user'];
  interface Published {
    id: string;
    slug: string;
    pricingId: string;
    version: string;
    text: string;
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Publishes a version through the API, as `token`'s user: a new pricing without `slug`. */
  async function publish(
    token: string,
    organizationId: string,
    params: { name: string; version: string; slug?: string; isPrivate?: boolean; change?: PricingChange; createdAt?: string }
  ): Promise<Published> {
    const text = pricingYaml(params.name, params.version, params.change, params.createdAt);
    const file = path.join(os.tmpdir(), `pull_request_${randomSuffix()}.yml`);
    await fsp.writeFile(file, text, 'utf8');
    generatedFilesToDelete.add(file);
    const url = params.slug
      ? `${BASE_PATH}/pricings/${organizationId}/${params.slug}/${encodeURIComponent(params.version)}`
      : `${BASE_PATH}/pricings/${organizationId}`;
    const response = await request(app())
      .post(url)
      .set(bearer(token))
      .field('private', String(params.isPrivate ?? false))
      .attach('yaml', file);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    pricingsToDelete.add(response.body.id);
    if (typeof response.body.yaml === 'string') {
      const relative = response.body.yaml.replace(/^https?:\/\/[^/]+\//, '');
      generatedFilesToDelete.add(path.resolve(process.cwd(), 'public', relative));
    }
    const stored = await PricingMongoose.findById(response.body.id).lean();
    return { id: response.body.id, slug: response.body.slug, pricingId: String(stored!.pricingId), version: params.version, text };
  }

  /**
   * P, owned by a new user: v1 and v2 public, then v3 private, the newest, with
   * a label, a date and content found nowhere else (`markers`).
   */
  async function pricingWithPrivateLatest() {
    const { user: owner, organizationId } = await createAndLoginUser('USER');
    const name = `pr_${randomSuffix()}`;
    const v1 = await publish(owner.token, organizationId, { name, version: '1.0.0' });
    const v2 = await publish(owner.token, organizationId, { name, slug: v1.slug, version: '2.0.0', change: V2 });
    const v3Label = `3.0.0-hidden-${randomSuffix()}`;
    const v3 = await publish(owner.token, organizationId, {
      name, slug: v1.slug, version: v3Label, isPrivate: true, createdAt: V3_CREATED_AT, change: both(V2, V3_ONLY),
    });
    return {
      owner, organizationId, name, slug: v1.slug, pricingId: v1.pricingId, v1, v2, v3,
      markers: [v3.id, v3Label, V3_CREATED_AT, 'zz-v3-only', '987.65'],
    };
  }

  /** A new user who is a MEMBER of the organization, with these permissions on the pricing (none if omitted). */
  async function memberOf(organizationId: string, slug: string, permissions?: { GET: boolean; PUT: boolean; DELETE: boolean; CREATE: boolean }) {
    const { user } = await createAndLoginUser('USER');
    await createMembership(user.id, organizationId, 'MEMBER');
    if (permissions) {
      const permission = await createEntityPermission(user.id, organizationId, 'pricing', slug, permissions);
      permissionsToDelete.add(String(permission._id ?? permission.id));
    }
    return user;
  }

  const outsider = async () => (await createAndLoginUser('USER')).user;

  const textSource = (pricingId: string, baseVersionId: string, proposedYaml: string) => ({
    kind: 'text', pricingId, baseVersionId, proposedYaml,
  });

  const open = (token: string, body: Record<string, unknown>) =>
    request(app()).post(PULL_REQUESTS).set(bearer(token)).send(body);

  /** Opens a pull request on top of `base` and expects it to be created. */
  async function openOn(user: User, pricing: { name: string; pricingId: string }, base: Published, change: PricingChange, title = 'Change a price') {
    const response = await open(user.token, {
      title, source: textSource(pricing.pricingId, base.id, pricingYaml(pricing.name, '9.0.0', both(V2, change))),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body;
  }

  const list = (token: string, pricingId: string, extra = '') =>
    request(app()).get(`${PULL_REQUESTS}?pricingId=${pricingId}${extra}`).set(bearer(token));
  const detail = (token: string, id: string) => request(app()).get(`${PULL_REQUESTS}/${id}`).set(bearer(token));
  const edit = (token: string, id: string, body: Record<string, unknown>) =>
    request(app()).put(`${PULL_REQUESTS}/${id}`).set(bearer(token)).send(body);
  const close = (token: string, id: string, body: Record<string, unknown> = {}) =>
    request(app()).post(`${PULL_REQUESTS}/${id}/close`).set(bearer(token)).send(body);

  const versionCount = (pricingId: string) => PricingMongoose.countDocuments({ pricingId: new mongoose.Types.ObjectId(pricingId) });
  const pullRequestCount = (pricingId: string) =>
    PricingPullRequestMongoose.countDocuments({ pricingId: new mongoose.Types.ObjectId(pricingId) });
  const stateIn = (body: any, id: string) => body.items.find((item: any) => item.id === id)?.state;

  /** Whether an answer (body or headers) names any of the markers. */
  const leaks = (response: { body: unknown; headers: unknown }, markers: string[]) => {
    const text = JSON.stringify(response.body ?? null) + JSON.stringify(response.headers ?? null);
    return markers.filter(marker => text.includes(marker));
  };

  /** Pull requests stored straight in the database (no limits, no checks). */
  async function storePullRequests(count: number, params: { pricingId: string; base: Published; authorId?: () => string; proposal?: (index: number) => string }) {
    await PricingPullRequestMongoose.insertMany(Array.from({ length: count }, (_, index) => ({
      pricingId: new mongoose.Types.ObjectId(params.pricingId),
      number: 1000 + index,
      title: `Stored ${index}`,
      authorId: new mongoose.Types.ObjectId(params.authorId?.() ?? newId()),
      status: 'open',
      base: { versionId: new mongoose.Types.ObjectId(params.base.id), version: params.base.version, yaml: params.base.text },
      proposed: { yaml: params.proposal?.(index) ?? params.base.text, suggestedVersion: '9.0.0' },
      proposalRevision: 1,
    })));
  }

  // ---------------------------------------------------------------------------
  // Opening pull requests
  // ---------------------------------------------------------------------------

  describe('Opening a pull request on the latest public version', { timeout: 30000 }, () => {
    let scene: Awaited<ReturnType<typeof pricingWithPrivateLatest>>;
    beforeAll(async () => {
      scene = await pricingWithPrivateLatest();
    });

    it('Offers the latest public version as the base, saying nothing of a newer private one (CA-1).', async () => {
      const external = await outsider();

      const response = await list(external.token, scene.pricingId);

      expect(response.status).toBe(200);
      expect(response.body.proposals).toEqual({ canOpen: true, reason: null, latest: { id: scene.v2.id, version: '2.0.0' } });
      expect(response.body.viewer).toEqual({ isMaintainer: false });
      expect(leaks(response, scene.markers)).toEqual([]);
    });

    it('Opens it without publishing anything, storing the proposal with the pricing\'s name (CA-2).', async () => {
      const external = await outsider();
      const before = await versionCount(scene.pricingId);

      const proposal = pricingYaml('Another name', '2.1.0', both(V2, goldAt(7.5)));
      const response = await open(external.token, {
        title: 'Raise GOLD', description: 'Because', source: textSource(scene.pricingId, scene.v2.id, proposal),
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        number: expect.any(Number),
        title: 'Raise GOLD',
        description: 'Because',
        status: 'open',
        author: { id: external.id, username: external.username },
        base: { versionId: scene.v2.id, version: '2.0.0' },
        proposed: { suggestedVersion: '2.1.0' },
        proposalRevision: 1,
        state: { kind: 'up-to-date' },
        warnings: [],
      });
      expect(response.body.base.yaml).toBe(scene.v2.text);
      expect(loadPricingDoc(response.body.proposed.yaml, STORED_PRICING_MAX_BYTES).saasName).toBe(scene.name);
      expect(await versionCount(scene.pricingId)).toBe(before);
    });

    it('Starts a maintainer\'s pull request from the latest public version too (CA-3).', async () => {
      const before = await pullRequestCount(scene.pricingId);
      const proposal = pricingYaml(scene.name, '2.1.0', both(V2, platinumAt(12)));

      const onPrivate = await open(scene.owner.token, { title: 'On v3', source: textSource(scene.pricingId, scene.v3.id, proposal) });
      expect(onPrivate.status).toBe(409);
      expect(onPrivate.body).toMatchObject({ code: 'BASE_NOT_LATEST', latest: { id: scene.v2.id, version: '2.0.0' } });
      expect(await pullRequestCount(scene.pricingId)).toBe(before);

      const onPublic = await open(scene.owner.token, { title: 'On v2', source: textSource(scene.pricingId, scene.v2.id, proposal) });
      expect(onPublic.status).toBe(201);
      expect(onPublic.body.base.versionId).toBe(scene.v2.id);
    });

    it('Refuses an older base naming only the latest public version, and answers 404 to a base that cannot be read (CA-4, CA-81).', async () => {
      const external = await outsider();
      const before = await pullRequestCount(scene.pricingId);
      const proposal = pricingYaml(scene.name, '2.1.0', both(V2, platinumAt(12)));

      const old = await open(external.token, { title: 'Old', source: textSource(scene.pricingId, scene.v1.id, proposal) });
      expect(old.status).toBe(409);
      expect(old.body).toEqual({
        error: expect.any(String), code: 'BASE_NOT_LATEST', latest: { id: scene.v2.id, version: '2.0.0' },
      });
      expect(leaks(old, scene.markers)).toEqual([]);

      // A private version, another pricing's version and an unknown id are the same 404.
      const other = await pricingWithPrivateLatest();
      for (const baseVersionId of [scene.v3.id, other.v2.id, newId()]) {
        const response = await open(external.token, { title: 'Hidden', source: textSource(scene.pricingId, baseVersionId, proposal) });
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Version not found', code: 'NOT_FOUND' });
      }
      expect(await pullRequestCount(scene.pricingId)).toBe(before);
    });

    it('Refuses a proposal that only changes the version, the date or the name (CA-15).', async () => {
      const external = await outsider();
      const before = await pullRequestCount(scene.pricingId);
      const proposal = pricingYaml('Renamed', '7.0.0', V2, '2020-01-01');

      const response = await open(external.token, { title: 'Nothing', source: textSource(scene.pricingId, scene.v2.id, proposal) });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('NO_CHANGES');
      expect(await pullRequestCount(scene.pricingId)).toBe(before);
    });

    it('Stores a proposal in an older syntax in the latest one, and says so.', async () => {
      const external = await outsider();
      const doc: any = loadPricingDoc(pricingYaml(scene.name, '2.1.0', both(V2, goldAt(6))), STORED_PRICING_MAX_BYTES);
      doc.syntaxVersion = '3.0';

      const response = await open(external.token, {
        title: 'Old syntax', source: textSource(scene.pricingId, scene.v2.id, dumpPricingDoc(doc)),
      });

      expect(response.status).toBe(201);
      expect(response.body.warnings).toEqual([{ code: 'SYNTAX_UPGRADED' }]);
      expect(loadPricingDoc(response.body.proposed.yaml, STORED_PRICING_MAX_BYTES).syntaxVersion).toBe('3.1');
    });

    it('Sends a base stored in an older syntax also upgraded, so the detail shows only the author\'s changes.', async () => {
      const own = await publicScene();
      const external = await outsider();
      // v2's file as the seeded pricings keep theirs: in syntax 2.1, which the updater changes beyond its number.
      const file = await fileOf(own.v2.id);
      const older: any = { ...docOf(readFileSync(file, 'utf8')), syntaxVersion: '2.1' };
      older.usageLimits.maxVisitsPerMonthAndPet = { ...older.usageLimits.maxVisitsPerMonthAndPet, type: 'TIME_DRIVEN' };
      delete older.usageLimits.maxVisitsPerMonthAndPet.period;
      const olderText = yaml.dump(older);
      await fsp.writeFile(file, olderText);
      const proposal = structuredClone(older);
      proposal.plans.GOLD.price = 7.5;

      const created = await open(external.token, { title: 'From 2.1', source: textSource(own.pricingId, own.v2.id, yaml.dump(proposal)) });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const shown = await detail(external.token, created.body.id);

      expect(shown.status).toBe(200);
      expect(shown.body.base.yaml).toBe(olderText);
      const normalized = docOf(shown.body.base.normalizedYaml);
      expect(normalized.syntaxVersion).toBe('3.1');
      expect(normalized).toEqual(upgradeToLatestSyntax(docOf(olderText)).doc);
      // Against it, the proposal changes GOLD's price and nothing else.
      const comparable = (doc: any) => {
        const { saasName, version, createdAt, ...rest } = doc;
        void saasName; void version; void createdAt;
        return rest;
      };
      expect(comparable(docOf(shown.body.proposed.yaml))).toEqual(comparable(goldAtNormalized(normalized, 7.5)));
      expect(comparable(docOf(shown.body.proposed.yaml))).not.toEqual(comparable(docOf(olderText)));

      // A base in the latest syntax is sent once.
      const current = await open(external.token, {
        title: 'From 3.1', source: textSource(scene.pricingId, scene.v2.id, pricingYaml(scene.name, '2.1.0', both(V2, goldAt(9)))),
      });
      expect(current.status).toBe(201);
      const plain = await detail(external.token, current.body.id);
      expect(plain.body.base).not.toHaveProperty('normalizedYaml');
    });

    it('Keeps markup as plain text and refuses titles that are too long or carry control characters (CA-80).', async () => {
      const external = await outsider();
      const markup = '<img src=x onerror=alert(1)>';
      const proposal = pricingYaml(scene.name, '2.1.0', both(V2, goldAt(8), doc => {
        doc.plans.GOLD.description = markup;
      }));

      const created = await open(external.token, {
        title: markup, description: `${markup}\nsecond line`, source: textSource(scene.pricingId, scene.v2.id, proposal),
      });
      expect(created.status).toBe(201);
      const shown = await detail(external.token, created.body.id);
      expect(shown.body.title).toBe(markup);
      expect(shown.body.description).toBe(`${markup}\nsecond line`);
      expect((loadPricingDoc(shown.body.proposed.yaml, STORED_PRICING_MAX_BYTES) as any).plans.GOLD.description).toBe(markup);
      // The parser itself refuses a link that is not http or https.
      const scriptLink = await open(external.token, {
        title: 'Link', source: textSource(scene.pricingId, scene.v2.id, pricingYaml(scene.name, '2.1.0', both(V2, doc => {
          doc.url = 'javascript:alert(1)';
        }))),
      });
      expect(scriptLink.status).toBe(400);
      expect(scriptLink.body).toMatchObject({ code: 'INVALID_PRICING', error: expect.stringContaining('javascript:alert(1)') });

      const closed = await close(external.token, created.body.id, { reason: markup });
      expect(closed.status).toBe(200);
      expect(closed.body.closed.reason).toBe(markup);

      const before = await pullRequestCount(scene.pricingId);
      for (const title of ['x'.repeat(201), 'Bell\u0007', '']) {
        const refused = await open(external.token, { title, source: textSource(scene.pricingId, scene.v2.id, proposal) });
        expect(refused.status, JSON.stringify(title)).toBe(422);
      }
      expect((await close(external.token, created.body.id, { reason: 'r'.repeat(501) })).status).toBe(422);
      expect(await pullRequestCount(scene.pricingId)).toBe(before);
    });

    it('Takes the author from the session only (CA-91).', async () => {
      const external = await outsider();
      const other = await outsider();
      const proposal = pricingYaml(scene.name, '2.1.0', both(V2, goldAt(9)));

      const created = await open(external.token, {
        title: 'Mine', authorId: other.id, author: { id: other.id }, email: other.email,
        source: textSource(scene.pricingId, scene.v2.id, proposal),
      });
      expect(created.status).toBe(201);
      expect(created.body.author.id).toBe(external.id);

      const edited = await edit(external.token, created.body.id, { title: 'Still mine', authorId: other.id });
      expect(edited.status).toBe(200);
      const stored = await PricingPullRequestMongoose.findById(created.body.id).lean();
      expect(String(stored!.authorId)).toBe(external.id);
      expect((await detail(other.token, created.body.id)).status).toBe(404);
    });

    it('Checks the base before the proposal, the size and complexity before the parser, and quotes the parser.', async () => {
      const external = await outsider();
      const before = await pullRequestCount(scene.pricingId);
      // A chain of merge keys, each one twice the size of the one before, that is also not a pricing.
      const bomb = ['a0: &a0 {k: 1}', ...Array.from({ length: 24 }, (_, i) => `a${i + 1}: &a${i + 1} {<<: [*a${i}], x${i}: *a${i}}`), 'saasName: 1'].join('\n');

      // 409 before 422/400: a stale base wins over a proposal that is too complex.
      const stale = await open(external.token, { title: 'Stale', source: textSource(scene.pricingId, scene.v1.id, bomb) });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('BASE_NOT_LATEST');

      // 422 before 400: too complex, though also invalid.
      const complex = await open(external.token, { title: 'Bomb', source: textSource(scene.pricingId, scene.v2.id, bomb) });
      expect(complex.status).toBe(422);
      expect(complex.body.code).toBe('PRICING_TOO_COMPLEX');

      // A combination the parser refuses is a 400 with its own words, never a 401 or 404
      // because of a feature named after one of the phrases handleError looks for.
      const invalid = pricingYaml(scene.name, '2.1.0', both(V2, doc => {
        doc.features['Unauthorized not found'] = {
          description: 'x', valueType: 'BOOLEAN', defaultValue: false, type: 'DOMAIN',
          expression: "pricingContext['features']['Unauthorized not found']",
        };
        doc.usageLimits.maxPets.linkedFeatures = ['Unauthorized not found', 'missing feature'];
      }));
      const refused = await open(external.token, { title: 'Invalid', source: textSource(scene.pricingId, scene.v2.id, invalid) });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('INVALID_PRICING');
      expect(refused.body.error).toContain('missing feature');
      expect(await pullRequestCount(scene.pricingId)).toBe(before);
    });
  });

  describe('Which version is the latest public one', { timeout: 30000 }, () => {
    it('Is the one SPHERE received last (addedAt), whatever its createdAt, then the one inserted last (CA-5, CA-6).', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const name = `pr_${randomSuffix()}`;
      const older = await publish(owner.token, organizationId, { name, version: '1.0.0' });
      // Inserted after `older`, so its _id is greater.
      const newer = await publish(owner.token, organizationId, { name, slug: older.slug, version: '2.0.0', change: V2 });
      const set = (version: Published, fields: Record<string, Date>) =>
        PricingMongoose.collection.updateOne({ _id: new mongoose.Types.ObjectId(version.id) }, { $set: fields });
      const latest = async () => (await list(owner.token, older.pricingId)).body.proposals.latest.id;
      const day = (n: number) => new Date(Date.UTC(2024, 0, n));

      // addedAt: createdAt tie, and the greater _id was received first.
      await set(older, { createdAt: day(1), addedAt: day(5) });
      await set(newer, { createdAt: day(1), addedAt: day(4) });
      expect(await latest()).toBe(older.id);

      // addedAt also wins over a createdAt that orders the other way.
      await set(newer, { createdAt: day(9) });
      expect(await latest()).toBe(older.id);

      // _id: createdAt and addedAt tie.
      await set(older, { createdAt: day(1), addedAt: day(5) });
      await set(newer, { createdAt: day(1), addedAt: day(5) });
      expect(await latest()).toBe(newer.id);
    });
  });

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  describe('Where a pull request stands', { timeout: 30000 }, () => {
    it('Is up to date for its author while its base is the latest public version, and behind for a maintainer of a newer private one (CA-8).', async () => {
      const scene = await pricingWithPrivateLatest();
      const external = await outsider();
      const clashing = await openOn(external, scene, scene.v2, goldAt(7.5), 'GOLD');
      const disjoint = await openOn(external, scene, scene.v2, platinumAt(12), 'PLATINUM');
      // A reader of the private versions without CREATE is compared with the latest public one too.
      const reader = await memberOf(scene.organizationId, scene.slug, { GET: true, PUT: false, DELETE: false, CREATE: false });
      const readers = await openOn(reader, scene, scene.v2, platinumAt(13), 'Reader');

      const asAuthor = await list(external.token, scene.pricingId);
      expect(stateIn(asAuthor.body, clashing.id)).toEqual({ kind: 'up-to-date' });
      expect(stateIn(asAuthor.body, disjoint.id)).toEqual({ kind: 'up-to-date' });
      expect((await detail(external.token, clashing.id)).body.state).toEqual({ kind: 'up-to-date' });
      expect((await detail(reader.token, readers.id)).body.state).toEqual({ kind: 'up-to-date' });
      const edited = await edit(external.token, clashing.id, { proposedYaml: pricingYaml(scene.name, '9.0.0', both(V2, goldAt(7.6))) });
      expect(edited.status).toBe(200);
      expect(edited.body.proposalRevision).toBe(2);

      const asOwner = await list(scene.owner.token, scene.pricingId);
      expect(asOwner.body.viewer).toEqual({ isMaintainer: true });
      expect(stateIn(asOwner.body, clashing.id)).toEqual({ kind: 'behind', conflicts: 1 });
      expect(stateIn(asOwner.body, disjoint.id)).toEqual({ kind: 'behind', conflicts: 0 });
      expect(stateIn(asOwner.body, readers.id)).toEqual({ kind: 'behind', conflicts: 0 });
      expect((await detail(scene.owner.token, clashing.id)).body.state).toEqual({ kind: 'behind', conflicts: 1 });
    });

    it('Is behind for its author once a newer public version exists: only title and description change until it is updated (CA-9).', async () => {
      const scene = await pricingWithPrivateLatest();
      const external = await outsider();
      const behind = await openOn(external, scene, scene.v2, goldAt(7.5));
      const included = await openOn(external, scene, scene.v2, goldAt(8));
      const clashing = await openOn(external, scene, scene.v2, platinumAt(14));
      const sameAsBase = await openOn(external, scene, scene.v2, platinumAt(15));
      // A proposal that does not change its base is refused, as when it was opened.
      const unchanged = await edit(external.token, sameAsBase.id, { proposedYaml: pricingYaml(scene.name, '9.0.0', V2) });
      expect(unchanged.status).toBe(400);
      expect(unchanged.body.code).toBe('NO_CHANGES');
      expect((await detail(external.token, sameAsBase.id)).body).toMatchObject({ proposalRevision: 1, state: { kind: 'up-to-date' } });

      const v4 = await publish(scene.owner.token, scene.organizationId, {
        name: scene.name, slug: scene.slug, version: '4.0.0', change: both(V2, goldAt(8), platinumAt(20)),
      });

      const states = (await list(external.token, scene.pricingId)).body;
      expect(stateIn(states, behind.id)).toEqual({ kind: 'behind', conflicts: 1 });
      expect(stateIn(states, included.id)).toEqual({ kind: 'no-changes' });
      expect(stateIn(states, clashing.id)).toEqual({ kind: 'behind', conflicts: 1 });
      expect((await detail(external.token, behind.id)).body.permissions).toMatchObject({ edit: true, editProposal: false, update: true });

      const proposal = await edit(external.token, behind.id, { proposedYaml: pricingYaml(scene.name, '9.0.0', both(V2, goldAt(7))) });
      expect(proposal.status).toBe(409);
      expect(proposal.body.code).toBe('PULL_REQUEST_BEHIND');

      const retitled = await edit(external.token, behind.id, { title: 'Renamed', description: 'Now with a description' });
      expect(retitled.status).toBe(200);
      expect(retitled.body).toMatchObject({ title: 'Renamed', description: 'Now with a description', proposalRevision: 1 });

      // Brought up to date, its proposal can change again.
      const preview = await request(app()).post(`${PULL_REQUESTS}/${behind.id}/merge-preview`).set(bearer(external.token)).send({ purpose: 'update' });
      expect(preview.body.target).toEqual({ id: v4.id, version: v4.version });
      const updated = await request(app()).post(`${PULL_REQUESTS}/${behind.id}/update`).set(bearer(external.token)).send({
        resolutions: { [JSON.stringify(['plans', 'GOLD', 'price'])]: 'proposal' }, previewToken: preview.body.previewToken,
      });
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body).toMatchObject({ base: { versionId: v4.id }, proposalRevision: 2 });
      const afterUpdate = await edit(external.token, behind.id, { proposedYaml: pricingYaml(scene.name, '9.0.0', both(V2, goldAt(7), platinumAt(20))) });
      expect(afterUpdate.status).toBe(200);
      expect(afterUpdate.body).toMatchObject({ proposalRevision: 3, state: { kind: 'up-to-date' } });
    });

    it('Has no changes once updated to a version that already has its proposal, and cannot be merged then.', async () => {
      const scene = await pricingWithPrivateLatest();
      const external = await outsider();
      const created = await openOn(external, scene, scene.v2, goldAt(7.5));
      const v4 = await publish(scene.owner.token, scene.organizationId, {
        name: scene.name, slug: scene.slug, version: '4.0.0', change: both(V2, goldAt(7.5)),
      });

      const preview = await request(app()).post(`${PULL_REQUESTS}/${created.id}/merge-preview`).set(bearer(external.token)).send({ purpose: 'update' });
      expect(preview.body.outcome).toBe('no-changes');
      const updated = await request(app()).post(`${PULL_REQUESTS}/${created.id}/update`).set(bearer(external.token)).send({
        previewToken: preview.body.previewToken,
      });
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body).toMatchObject({ base: { versionId: v4.id }, state: { kind: 'no-changes' } });

      expect(stateIn((await list(external.token, scene.pricingId)).body, created.id)).toEqual({ kind: 'no-changes' });
      const asOwner = await detail(scene.owner.token, created.id);
      expect(asOwner.body.state).toEqual({ kind: 'no-changes' });
      expect(asOwner.body.permissions).toMatchObject({ close: true, merge: false });
      const mergePreview = await request(app()).post(`${PULL_REQUESTS}/${created.id}/merge-preview`).set(bearer(scene.owner.token)).send({ purpose: 'merge' });
      expect(mergePreview.body.outcome).toBe('no-changes');
      const merged = await request(app()).post(`${PULL_REQUESTS}/${created.id}/merge`).set(bearer(scene.owner.token)).send({
        previewToken: mergePreview.body.previewToken, version: '5.0.0', private: false,
      });
      expect(merged.status, JSON.stringify(merged.body)).toBe(400);
      expect(merged.body.code).toBe('NO_CHANGES');
    });

    it('Is merged once merged, whatever its base.', async () => {
      const scene = await pricingWithPrivateLatest();
      const external = await outsider();
      const created = await openOn(external, scene, scene.v2, goldAt(7.5));
      await publish(scene.owner.token, scene.organizationId, { name: scene.name, slug: scene.slug, version: '4.0.0', change: both(V2, platinumAt(20)) });
      const lock = await repository.reserveForMerge(created.id, 1, scene.owner.id);
      await repository.markMerged(created.id, lock!.id, {
        byId: scene.owner.id, at: new Date(), versionId: scene.v2.id, version: '2.0.0', proposalRevision: 1,
      });

      for (const token of [external.token, scene.owner.token]) {
        expect((await detail(token, created.id)).body.state).toEqual({ kind: 'merged' });
      }
    });
  });

  describe('A pricing left without public versions', { timeout: 30000 }, () => {
    it('Is not found for authors who cannot read private versions, and has no public version for those who can (CA-7, CA-103).', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const name = `pr_${randomSuffix()}`;
      const v1 = await publish(owner.token, organizationId, { name, version: '1.0.0' });
      const pricing = { name, pricingId: v1.pricingId };
      const external = await outsider();
      const reader = await memberOf(organizationId, v1.slug, { GET: true, PUT: false, DELETE: false, CREATE: false });
      const externals = await openOn(external, pricing, v1, goldAt(7.5));
      const readers = await openOn(reader, pricing, v1, goldAt(7.5));

      await PricingMongoose.updateMany({ pricingId: new mongoose.Types.ObjectId(v1.pricingId) }, { $set: { private: true } });

      const proposal = pricingYaml(name, '9.0.0', both(V2, goldAt(6)));
      const notFound = [
        await list(external.token, v1.pricingId),
        await detail(external.token, externals.id),
        await edit(external.token, externals.id, { title: 'Again' }),
        await close(external.token, externals.id),
        await open(external.token, { title: 'New', source: textSource(v1.pricingId, v1.id, proposal) }),
      ];
      for (const response of notFound) expect(response.status, JSON.stringify(response.body)).toBe(404);

      const listed = await list(reader.token, v1.pricingId);
      expect(listed.status).toBe(200);
      expect(listed.body.proposals).toEqual({ canOpen: false, reason: 'NO_PUBLIC_VERSION', latest: null });
      const shown = await detail(reader.token, readers.id);
      expect(shown.body.state).toEqual({ kind: 'no-public-version' });
      expect(shown.body.permissions).toMatchObject({ edit: true, editProposal: false, update: false });
      const proposalEdit = await edit(reader.token, readers.id, { proposedYaml: proposal });
      expect(proposalEdit.status).toBe(409);
      expect(proposalEdit.body.code).toBe('NO_PUBLIC_VERSION');
      expect((await edit(reader.token, readers.id, { title: 'Still editable' })).status).toBe(200);
      const created = await open(reader.token, { title: 'New', source: textSource(v1.pricingId, v1.id, proposal) });
      expect(created.status).toBe(409);
      expect(created.body.code).toBe('NO_PUBLIC_VERSION');
    });
  });

  // ---------------------------------------------------------------------------
  // Who sees and acts
  // ---------------------------------------------------------------------------

  describe('Who sees a pull request and what they may do', { timeout: 30000 }, () => {
    let scene: Awaited<ReturnType<typeof pricingWithPrivateLatest>>;
    beforeAll(async () => {
      scene = await pricingWithPrivateLatest();
    });

    it('Shows it to its author and to the maintainers, and is not found for anyone else (CA-43, CA-44).', async () => {
      const author = await outsider();
      const created = await openOn(author, scene, scene.v2, goldAt(7.5));
      const admin = (await createAndLoginUser('USER')).user;
      await createMembership(admin.id, scene.organizationId, 'ADMIN');
      const creator = await memberOf(scene.organizationId, scene.slug, { GET: true, PUT: false, DELETE: false, CREATE: true });
      const globalAdmin = testContainer.resolve('adminUser');

      for (const maintainer of [scene.owner, admin, creator, globalAdmin]) {
        const listed = await list(maintainer.token, scene.pricingId);
        expect(listed.body.viewer, maintainer.username).toEqual({ isMaintainer: true });
        expect(listed.body.items.map((item: any) => item.id)).toContain(created.id);
        const shown = await detail(maintainer.token, created.id);
        expect(shown.status).toBe(200);
        expect(shown.body.permissions).toEqual({ edit: false, editProposal: false, update: false, close: true, merge: true });
      }

      // Members who may not publish versions, or who may but not read the private ones, and outsiders.
      const editor = await memberOf(scene.organizationId, scene.slug, { GET: true, PUT: true, DELETE: false, CREATE: false });
      const blindCreator = await memberOf(scene.organizationId, scene.slug, { GET: false, PUT: false, DELETE: false, CREATE: true });
      const stranger = await outsider();
      const strangers = await openOn(stranger, scene, scene.v2, platinumAt(12));
      for (const other of [editor, blindCreator, stranger]) {
        expect((await detail(other.token, created.id)).status, other.username).toBe(404);
        expect((await close(other.token, created.id)).status).toBe(404);
        expect((await edit(other.token, created.id, { title: 'Mine now' })).status).toBe(404);
        const listed = await list(other.token, scene.pricingId);
        expect(listed.body.viewer).toEqual({ isMaintainer: false });
        expect(listed.body.items.map((item: any) => item.id)).not.toContain(created.id);
      }
      const strangerList = await list(stranger.token, scene.pricingId);
      expect(strangerList.body.items.map((item: any) => item.id)).toEqual([strangers.id]);
      expect(strangerList.body).toMatchObject({ total: 1, counts: { open: 1, merged: 0, closed: 0 } });

      expect((await detail(author.token, created.id)).body.permissions).toEqual({
        edit: true, editProposal: true, update: false, close: true, merge: false,
      });
    });

    it('Lets its author withdraw it and a maintainer reject it with a reason, and only while it is open (CA-52).', async () => {
      const author = await outsider();
      const withdrawn = await openOn(author, scene, scene.v2, goldAt(7.5));
      const rejected = await openOn(author, scene, scene.v2, platinumAt(12));
      const creator = await memberOf(scene.organizationId, scene.slug, { GET: true, PUT: false, DELETE: false, CREATE: true });

      const byAuthor = await close(author.token, withdrawn.id);
      expect(byAuthor.status).toBe(200);
      expect(byAuthor.body).toMatchObject({ status: 'closed', closed: { kind: 'withdrawn' }, state: { kind: 'closed' } });

      expect((await edit(creator.token, rejected.id, { title: 'Not theirs' })).status).toBe(403);
      const byMaintainer = await close(creator.token, rejected.id, { reason: 'Not now' });
      expect(byMaintainer.status).toBe(200);
      expect(byMaintainer.body).toMatchObject({ status: 'closed', closed: { kind: 'rejected', reason: 'Not now' } });

      for (const response of [await close(author.token, withdrawn.id), await edit(author.token, rejected.id, { title: 'Late' })]) {
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('PULL_REQUEST_NOT_OPEN');
      }
      const listed = await list(author.token, scene.pricingId, '&status=closed');
      expect(listed.body.items.map((item: any) => item.id).sort()).toEqual([withdrawn.id, rejected.id].sort());
    });

    it('Holds off edits and closing while a merge holds it, and not once the reservation lapsed.', async () => {
      const author = await outsider();
      const created = await openOn(author, scene, scene.v2, goldAt(7.5));
      await repository.reserveForMerge(created.id, 1, scene.owner.id);

      for (const response of [await edit(author.token, created.id, { title: 'During' }), await close(author.token, created.id)]) {
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('PULL_REQUEST_MERGING');
      }
      await PricingPullRequestMongoose.updateOne({ _id: created.id }, { $set: { 'mergeLock.until': new Date(Date.now() - 1000) } });
      expect((await edit(author.token, created.id, { title: 'After' })).status).toBe(200);
    });

    it('Lets an OWNER who reads the newer private version edit their own proposal (CA-88).', async () => {
      const created = await openOn(scene.owner, scene, scene.v2, goldAt(7.5));

      const edited = await edit(scene.owner.token, created.id, { proposedYaml: pricingYaml(scene.name, '9.0.0', both(V2, goldAt(7))) });

      expect(edited.status).toBe(200);
      expect(edited.body.proposalRevision).toBe(2);
    });

    it('Never publishes for an author who may only read the pricing (CA-82).', async () => {
      const reader = await memberOf(scene.organizationId, scene.slug, { GET: true, PUT: false, DELETE: false, CREATE: false });
      const before = await versionCount(scene.pricingId);

      const created = await openOn(reader, scene, scene.v2, goldAt(7.5));

      expect(created.permissions.merge).toBe(false);
      expect(await versionCount(scene.pricingId)).toBe(before);
    });
  });

  describe('Web sessions only', { timeout: 30000 }, () => {
    it('Answers 401 to API keys, OAuth tokens, cookies and anonymous callers on every route (CA-45, CA-90).', async () => {
      const scene = await pricingWithPrivateLatest();
      const author = await outsider();
      const created = await openOn(author, scene, scene.v2, goldAt(7.5));
      const keyResponse = await request(app())
        .post(`${BASE_PATH}/users/${author.username}/api-keys`)
        .set(bearer(author.token))
        .send({ name: `key ${randomSuffix()}`, scopes: [{ organizationId: scene.organizationId, scope: 'ALL' }] });
      expect(keyResponse.status).toBe(201);
      // An OAuth access token the MCP server accepts for the same user.
      const oauthRepository = appContainer.resolve('oauthRepository');
      const oauthService = appContainer.resolve('oauthService');
      const grant = await oauthRepository.createGrant({
        userId: author.id, clientId: `pr-test-${randomSuffix()}`, clientName: 'Claude', resource: oauthResource(),
        scopes: [{ organizationId: scene.organizationId, scope: 'ALL' }], refreshHash: `pending_${randomSuffix()}`,
        expiresAt: new Date(Date.now() + HOUR),
      });
      const grantId = String(grant._id);
      try {
        const oauthToken: string = (await oauthService.issue(grantId)).access_token;
        expect(String((await oauthService.authenticate(oauthToken)).user.id)).toBe(author.id);

        const proposal = pricingYaml(scene.name, '9.0.0', both(V2, goldAt(6)));
        const body = { title: 'Again', source: textSource(scene.pricingId, scene.v2.id, proposal) };
        const routes = [
          (call: any) => call.get(`${PULL_REQUESTS}?pricingId=${scene.pricingId}`),
          (call: any) => call.post(PULL_REQUESTS).send(body),
          (call: any) => call.get(`${PULL_REQUESTS}/fork-target?forkPricingId=${scene.pricingId}`),
          (call: any) => call.post(`${PULL_REQUESTS}/previews`).send({ source: body.source }),
          (call: any) => call.get(`${PULL_REQUESTS}/${created.id}`),
          (call: any) => call.put(`${PULL_REQUESTS}/${created.id}`).send({ title: 'Changed' }),
          (call: any) => call.post(`${PULL_REQUESTS}/${created.id}/merge-preview`).send({ purpose: 'merge' }),
          (call: any) => call.post(`${PULL_REQUESTS}/${created.id}/update`).send({ previewToken: 'x.y' }),
          (call: any) => call.post(`${PULL_REQUESTS}/${created.id}/merge`).send({ previewToken: 'x.y', version: '9.0.0' }),
          (call: any) => call.post(`${PULL_REQUESTS}/${created.id}/close`).send({}),
        ];
        const anonymous = await routes[0](request(app()));
        expect(anonymous.status).toBe(401);

        for (const [index, route] of routes.entries()) {
          const withKey = await route(request(app())).set('x-api-key', keyResponse.body.plainKey);
          expect(withKey.status, `API key on route ${index}`).toBe(401);
          expect(withKey.body).toEqual({ error: 'A SPHERE web session is required', code: 'WEB_SESSION_REQUIRED' });

          // A valid OAuth token is turned away before it authenticates anyone.
          const withOAuth = await route(request(app())).set('Authorization', `Bearer ${oauthToken}`);
          expect(withOAuth.status, `OAuth on route ${index}`).toBe(401);
          expect(withOAuth.body).toEqual({ error: 'OAuth access tokens are restricted to MCP' });

          // The same web session token in a cookie, under the names a browser might use, is no session.
          const cookie = ['token', 'accessToken', 'authToken', 'jwt'].map(name => `${name}=${author.token}`).join('; ');
          const withCookie = await route(request(app())).set('Cookie', cookie);
          expect(withCookie.status, `Cookie on route ${index}`).toBe(401);
          expect(withCookie.body).toEqual(anonymous.body);

          expect((await route(request(app()))).status, `anonymous on route ${index}`).toBe(401);
        }
        // The same token as a web session is let in.
        expect((await routes[0](request(app())).set(bearer(author.token))).status).toBe(200);
      } finally {
        await OAuthToken.deleteMany({ grantId });
        await OAuthGrant.deleteOne({ _id: grantId });
      }
      const stored = await PricingPullRequestMongoose.findById(created.id).lean();
      expect(stored).toMatchObject({ title: 'Change a price', status: 'open' });
      expect(await pullRequestCount(scene.pricingId)).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Limits
  // ---------------------------------------------------------------------------

  describe('Limits', { timeout: 30000 }, () => {
    const LIMIT_VARIABLES = ['PRICING_PR_MAX_OPEN_PER_AUTHOR', 'PRICING_PR_MAX_OPEN_PER_PRICING', 'PRICING_PR_MAX_CREATED_PER_DAY'];
    afterEach(() => {
      for (const variable of LIMIT_VARIABLES) delete process.env[variable];
    });

    /** P with two public versions, v1 and v2. */
    async function twoPublicVersions() {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const name = `pr_${randomSuffix()}`;
      const v1 = await publish(owner.token, organizationId, { name, version: '1.0.0' });
      const v2 = await publish(owner.token, organizationId, { name, slug: v1.slug, version: '2.0.0', change: V2 });
      return { owner, organizationId, name, pricingId: v1.pricingId, v1, v2 };
    }

    it('Refuses the sixth open pull request of an author, after 404 and before anything else, with a generic reason (CA-47).', async () => {
      const pricing = await twoPublicVersions();
      const author = await outsider();
      await storePullRequests(5, { pricingId: pricing.pricingId, base: pricing.v2, authorId: () => author.id });
      const proposal = pricingYaml(pricing.name, '9.0.0', both(V2, goldAt(7)));

      const sixth = await open(author.token, { title: 'Sixth', source: textSource(pricing.pricingId, pricing.v2.id, proposal) });
      expect(sixth.status).toBe(429);
      expect(sixth.body.code).toBe('LIMIT_REACHED');
      // 429 before 409: also with a stale base.
      expect((await open(author.token, { title: 'Stale', source: textSource(pricing.pricingId, pricing.v1.id, proposal) })).status).toBe(429);
      // 404 before 429: a pricing the author may not read.
      const hidden = await publish(pricing.owner.token, pricing.organizationId, { name: `pr_${randomSuffix()}`, version: '1.0.0', isPrivate: true });
      await storePullRequests(5, { pricingId: hidden.pricingId, base: hidden, authorId: () => author.id });
      expect((await open(author.token, { title: 'Hidden', source: textSource(hidden.pricingId, hidden.id, proposal) })).status).toBe(404);

      expect((await list(author.token, pricing.pricingId)).body.proposals).toMatchObject({ canOpen: false, reason: 'LIMIT_REACHED' });
      expect(await pullRequestCount(pricing.pricingId)).toBe(5);
    });

    it('Refuses the 51st open pull request of a pricing, naming the limit only to its maintainers (CA-47).', async () => {
      const pricing = await twoPublicVersions();
      const author = await outsider();
      await storePullRequests(50, { pricingId: pricing.pricingId, base: pricing.v2 });

      const response = await open(author.token, {
        title: '51st', source: textSource(pricing.pricingId, pricing.v2.id, pricingYaml(pricing.name, '9.0.0', both(V2, goldAt(7)))),
      });

      expect(response.status).toBe(429);
      expect(response.body.code).toBe('LIMIT_REACHED');
      expect((await list(author.token, pricing.pricingId)).body.proposals.reason).toBe('LIMIT_REACHED');
      expect((await list(pricing.owner.token, pricing.pricingId)).body.proposals.reason).toBe('PRICING_LIMIT');
      expect(await pullRequestCount(pricing.pricingId)).toBe(50);
    });

    it('Refuses the 21st pull request an author creates in a day, on any pricing (CA-47).', async () => {
      const pricing = await twoPublicVersions();
      const author = await outsider();
      const elsewhere = trackedPricingId();
      await storePullRequests(20, { pricingId: elsewhere, base: pricing.v2, authorId: () => author.id });

      const response = await open(author.token, {
        title: '21st', source: textSource(pricing.pricingId, pricing.v2.id, pricingYaml(pricing.name, '9.0.0', both(V2, goldAt(7)))),
      });

      expect(response.status).toBe(429);
      expect(response.body.code).toBe('LIMIT_REACHED');
      expect(await pullRequestCount(pricing.pricingId)).toBe(0);
    });

    it('Takes each limit from its environment variable (CA-47).', async () => {
      const pricing = await twoPublicVersions();
      const proposal = (price: number) => pricingYaml(pricing.name, '9.0.0', both(V2, goldAt(price)));
      const attempt = (user: User, price: number) =>
        open(user.token, { title: 'Limited', source: textSource(pricing.pricingId, pricing.v2.id, proposal(price)) });

      for (const variable of LIMIT_VARIABLES) {
        process.env[variable] = '1';
        const author = await outsider();
        if (variable === 'PRICING_PR_MAX_OPEN_PER_PRICING') {
          // The pricing already has open pull requests from the variables tried before.
          expect((await attempt(author, 7)).status, variable).toBe(429);
        } else {
          expect((await attempt(author, 7)).status, variable).toBe(201);
          expect((await attempt(author, 8)).status, variable).toBe(429);
        }
        delete process.env[variable];
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Private versions
  // ---------------------------------------------------------------------------

  describe('What reaches who may not read the private versions', { timeout: 30000 }, () => {
    it('Never names, dates or quotes a private version in any answer (CA-46).', async () => {
      const scene = await pricingWithPrivateLatest();
      const external = await outsider();
      const blindCreator = await memberOf(scene.organizationId, scene.slug, { GET: false, PUT: false, DELETE: false, CREATE: true });
      const responses: Array<{ body: unknown; headers: unknown }> = [];

      for (const author of [external, blindCreator]) {
        const proposal = (price: number) => pricingYaml(scene.name, '9.0.0', both(V2, goldAt(price)));
        const created = await open(author.token, { title: 'Mine', source: textSource(scene.pricingId, scene.v2.id, proposal(7)) });
        expect(created.status).toBe(201);
        const id = created.body.id;
        const mergedPrivately = await openOn(author, scene, scene.v2, platinumAt(12));
        const lock = await repository.reserveForMerge(mergedPrivately.id, 1, scene.owner.id);
        await repository.markMerged(mergedPrivately.id, lock!.id, {
          byId: scene.owner.id, at: new Date(), versionId: scene.v3.id, version: scene.v3.version, proposalRevision: 1,
        });
        responses.push(
          created,
          await list(author.token, scene.pricingId),
          await list(author.token, scene.pricingId, '&status=merged'),
          await detail(author.token, id),
          await detail(author.token, mergedPrivately.id),
          await edit(author.token, id, { title: 'Retitled' }),
          await edit(author.token, id, { proposedYaml: proposal(8) }),
          await open(author.token, { title: 'Old', source: textSource(scene.pricingId, scene.v1.id, proposal(9)) }),
          await open(author.token, { title: 'Hidden', source: textSource(scene.pricingId, scene.v3.id, proposal(9)) }),
          await open(author.token, { title: 'Nothing', source: textSource(scene.pricingId, scene.v2.id, pricingYaml(scene.name, '9.0.0', V2)) }),
          await edit(author.token, mergedPrivately.id, { title: 'Late' }),
          await close(author.token, id),
          await close(author.token, id),
        );
        const merged = (await detail(author.token, mergedPrivately.id)).body.merged;
        expect(Object.keys(merged)).toEqual(['at']);
      }

      expect(responses.map(response => leaks(response, scene.markers)).flat()).toEqual([]);
      // Who may read it is told which version it became.
      const ownerView = await list(scene.owner.token, scene.pricingId, '&status=merged');
      expect(ownerView.body.items[0].merged).toMatchObject({ versionId: scene.v3.id, version: scene.v3.version });
    });

    it('Names the fork a proposal came from only as far as the caller may read it, and never its base (CA-101).', async () => {
      const scene = await pricingWithPrivateLatest();
      const { user: forker, organizationId: forkOrganizationId } = await createAndLoginUser('USER');
      const fork = await forkPricingIntoOrganization({
        token: forker.token, sourceOrganizationId: scene.organizationId, sourceSlug: scene.slug, sourceVersion: '2.0.0',
        targetOrganizationId: forkOrganizationId, name: `fork_${randomSuffix()}`,
      });
      const forkBase = await PricingMongoose.findById(fork.id).lean();
      const forkId = String(forkBase!.pricingId);
      const proposed = await publish(forker.token, forkOrganizationId, {
        name: fork.name, slug: fork.slug, version: '2.5.0', isPrivate: true, change: both(V2, goldAt(7.5)),
      });
      const created = await repository.create({
        pricingId: scene.pricingId,
        title: 'From the fork',
        description: '',
        authorId: forker.id,
        base: { versionId: scene.v2.id, version: '2.0.0', yaml: scene.v2.text },
        proposed: { yaml: pricingYaml(scene.name, '2.5.0', both(V2, goldAt(7.5))), suggestedVersion: '2.5.0' },
        origin: { pricingId: forkId, versionId: proposed.id, version: '2.5.0', baseVersionId: fork.id, edited: false },
      });

      const asForker = await detail(forker.token, created.id);
      expect(asForker.body.origin).toEqual({
        pricingId: forkId, name: fork.name, slug: fork.slug,
        organization: { id: forkOrganizationId, name: expect.any(String), displayName: expect.any(String) },
        versionId: proposed.id, version: '2.5.0', editedAfterProposal: false,
      });
      expect(JSON.stringify(asForker.body)).not.toContain(fork.id);

      // The maintainers of P may read the fork but not its private version.
      const asOwner = await detail(scene.owner.token, created.id);
      expect(asOwner.body.origin).toEqual({
        pricingId: forkId, name: fork.name, slug: fork.slug,
        organization: { id: forkOrganizationId, name: expect.any(String), displayName: expect.any(String) },
        editedAfterProposal: false,
      });
      expect(JSON.stringify(asOwner.body)).not.toContain(fork.id);
      expect(JSON.stringify(asOwner.body)).not.toContain(proposed.id);

      // Nor a fork that only has private versions.
      await PricingMongoose.updateMany({ pricingId: forkBase!.pricingId }, { $set: { private: true } });
      expect((await detail(scene.owner.token, created.id)).body.origin).toBeUndefined();
    });

    it('Answers the same whether the version a proposal names exists privately or not (CA-102).', async () => {
      const scene = await pricingWithPrivateLatest();
      const external = await outsider();
      const created = await open(external.token, {
        title: 'Same label', source: textSource(scene.pricingId, scene.v2.id, pricingYaml(scene.name, scene.v3.version, both(V2, goldAt(7)))),
      });
      expect(created.status).toBe(201);
      const withPrivate = await detail(external.token, created.body.id);

      await PricingMongoose.deleteOne({ _id: scene.v3.id });
      const without = await detail(external.token, created.body.id);

      expect(withPrivate.body.proposed.suggestedVersion).toBe(scene.v3.version);
      expect(without.body).toEqual(withPrivate.body);
    });
  });

  describe('Computing where pull requests stand', { timeout: 30000 }, () => {
    beforeEach(() => {
      vi.mocked(mergePricingDocs).mockClear();
    });

    it('Merges each pull request of a listing once, and again only when its proposal changes (CA-98).', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const name = `pr_${randomSuffix()}`;
      const v1 = await publish(owner.token, organizationId, { name, version: '1.0.0' });
      await storePullRequests(20, {
        pricingId: v1.pricingId, base: v1, proposal: index => pricingYaml(name, '9.0.0', platinumAt(20 + index)),
      });
      // A newer public version leaves all of them behind.
      await publish(owner.token, organizationId, { name, slug: v1.slug, version: '2.0.0', change: V2 });
      vi.mocked(mergePricingDocs).mockClear();

      const first = await list(owner.token, v1.pricingId);
      const second = await list(owner.token, v1.pricingId);

      expect(first.body.items).toHaveLength(20);
      expect(first.body.items.every((item: any) => item.state.kind === 'behind')).toBe(true);
      expect(second.body.items.map((item: any) => item.state)).toEqual(first.body.items.map((item: any) => item.state));
      expect(mergePricingDocs).toHaveBeenCalledTimes(20);

      const changed = first.body.items[0];
      await repository.updateOpen(changed.id, 1, { proposed: { yaml: pricingYaml(name, '9.0.0', platinumAt(99)), suggestedVersion: '9.0.0' } });
      await list(owner.token, v1.pricingId);
      expect(mergePricingDocs).toHaveBeenCalledTimes(21);
    });
  });

  // ---------------------------------------------------------------------------
  // Previews, proposals from forks and updates: helpers
  // ---------------------------------------------------------------------------

  const GOLD_PRICE = JSON.stringify(['plans', 'GOLD', 'price']);
  const UPLOADED = path.resolve(process.cwd(), 'public', 'static', 'pricings', 'uploaded');
  /** GOLD's price in the template, as a conflict side writes it. */
  const TEMPLATE_GOLD_PRICE = yaml.dump((TEMPLATE as any).plans.GOLD.price);

  const previews = (token: string, body: Record<string, unknown>) =>
    request(app()).post(`${PULL_REQUESTS}/previews`).set(bearer(token)).send(body);
  const forkTarget = (token: string, forkPricingId: string) =>
    request(app()).get(`${PULL_REQUESTS}/fork-target?forkPricingId=${forkPricingId}`).set(bearer(token));
  const mergePreview = (token: string, id: string, body: Record<string, unknown>) =>
    request(app()).post(`${PULL_REQUESTS}/${id}/merge-preview`).set(bearer(token)).send(body);
  const updateToLatest = (token: string, id: string, body: Record<string, unknown>) =>
    request(app()).post(`${PULL_REQUESTS}/${id}/update`).set(bearer(token)).send(body);
  const forkSource = (forkPricingId: string) => ({ kind: 'fork', forkPricingId });
  const previewFork = (token: string, forkPricingId: string, resolutions?: Record<string, string>) =>
    previews(token, { source: forkSource(forkPricingId), ...(resolutions ? { resolutions } : {}) });
  /** Proposes the fork as `preview` showed it. */
  const proposeFork = (token: string, forkPricingId: string, preview: { previewToken: string }, extra: Record<string, unknown> = {}) =>
    open(token, { title: 'From the fork', source: forkSource(forkPricingId), previewToken: preview.previewToken, ...extra });
  const docOf = (text: string): any => loadPricingDoc(text, STORED_PRICING_MAX_BYTES);
  const reorderPlans = (...names: string[]): PricingChange => doc => {
    doc.plans = Object.fromEntries(names.map(name => [name, doc.plans[name]]));
  };
  const withFeature = (feature: string): PricingChange => doc => {
    doc.features[feature] = {
      description: 'Added', valueType: 'BOOLEAN', defaultValue: false, type: 'DOMAIN',
      expression: `pricingContext['features']['${feature}']`,
    };
  };
  const fileOf = async (versionId: string) => requirePricingFile(String((await PricingMongoose.findById(versionId).lean())!.yaml));
  const hashOf = async (versionId: string) => createHash('sha256').update(readFileSync(await fileOf(versionId))).digest('hex');
  /**
   * What `uploaded/` holds: its top-level folders, and every file inside those
   * named after `folders` (the scene's pricings and organizations). The whole
   * tree is too large to list on every run.
   */
  const uploadedFiles = async (folders: string[]) => {
    const top = (await fsp.readdir(UPLOADED)).sort();
    const inside = [];
    for (const folder of folders.filter(name => top.includes(name))) {
      inside.push(...(await fsp.readdir(path.join(UPLOADED, folder), { recursive: true })).map(file => `${folder}/${file}`));
    }
    return { top, inside: inside.sort() };
  };

  /** A new version of the fork, published through the API by its owner. */
  const publishFork = (scene: { forker: User; forkOrganizationId: string; fork: { name: string; slug: string } }, version: string, change: PricingChange, isPrivate = false) =>
    publish(scene.forker.token, scene.forkOrganizationId, { name: scene.fork.name, slug: scene.fork.slug, version, change, isPrivate });

  /**
   * P (v1 with `initial`, then v2 with `current` on top) owned by one user, and a
   * fork F of P@v1 owned by another, whose latest version F2 makes `proposal` on
   * top of v1.
   */
  async function forkScene(params: { initial?: PricingChange; current?: PricingChange; proposal?: PricingChange } = {}) {
    const initial = params.initial ?? (() => undefined);
    const { user: owner, organizationId } = await createAndLoginUser('USER');
    const name = `pr_${randomSuffix()}`;
    const v1 = await publish(owner.token, organizationId, { name, version: '1.0.0', change: initial });
    const { user: forker, organizationId: forkOrganizationId } = await createAndLoginUser('USER');
    const fork = await forkPricingIntoOrganization({
      token: forker.token, sourceOrganizationId: organizationId, sourceSlug: v1.slug, sourceVersion: '1.0.0',
      targetOrganizationId: forkOrganizationId, name: `fork_${randomSuffix()}`,
    });
    const forkId = String((await PricingMongoose.findById(fork.id).lean())!.pricingId);
    const v2 = await publish(owner.token, organizationId, { name, slug: v1.slug, version: '2.0.0', change: both(initial, params.current ?? V2) });
    const scene = { owner, organizationId, name, slug: v1.slug, pricingId: v1.pricingId, v1, v2, forker, forkOrganizationId, fork, forkId };
    const f2 = await publishFork(scene, '1.1.0', both(initial, params.proposal ?? goldAt(30)));
    return { ...scene, f2 };
  }
  type ForkScene = Awaited<ReturnType<typeof forkScene>>;

  /** Previews the fork, expects it to be fine, and proposes it with `resolutions`. */
  async function proposeFromScene(scene: Pick<ForkScene, 'forker' | 'forkId'>, resolutions?: Record<string, string>) {
    const preview = await previewFork(scene.forker.token, scene.forkId, resolutions);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    return proposeFork(scene.forker.token, scene.forkId, preview.body, resolutions ? { resolutions } : {});
  }

  // ---------------------------------------------------------------------------
  // Proposing from a fork
  // ---------------------------------------------------------------------------

  describe('Proposing the latest version of a fork to its parent', { timeout: 30000 }, () => {
    it('Combines the fork\'s changes with the latest public version, without conflicts and without publishing (CA-11, CA-12, CA-89).', async () => {
      const scene = await forkScene({ proposal: both(goldAt(30), withFeature('x-from-fork')) });
      const before = await versionCount(scene.pricingId);

      const target = await forkTarget(scene.forker.token, scene.forkId);
      expect(target.body).toEqual({
        canPropose: true,
        parent: { pricingId: scene.pricingId, name: scene.name, slug: scene.slug, organizationId: scene.organizationId },
      });

      const preview = await previewFork(scene.forker.token, scene.forkId);
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      expect(preview.body).toMatchObject({
        base: { id: scene.fork.id }, target: { id: scene.v2.id, version: '2.0.0' },
        outcome: 'merged', conflicts: [], regenerated: true, validation: { ok: true }, suggestedVersion: '1.1.0',
      });
      // Both sides changed, so the result is written again (CA-89).
      expect(preview.body.warnings).toContainEqual({ code: 'FORMAT_REGENERATED' });
      const result = docOf(preview.body.resultYaml);
      expect(result.plans.BASIC.price).toBe(1);
      expect(result.plans.GOLD.price).toBe(30);
      expect(result.features['x-from-fork']).toBeDefined();
      // The fork's version, date and name are not changes; the result keeps P's name (CA-12).
      expect(result.saasName).toBe(scene.name);

      const created = await proposeFork(scene.forker.token, scene.forkId, preview.body);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body).toMatchObject({
        base: { versionId: scene.v2.id, version: '2.0.0' },
        proposed: { suggestedVersion: '1.1.0' },
        origin: { pricingId: scene.forkId, versionId: scene.f2.id, version: '1.1.0', editedAfterProposal: false },
        state: { kind: 'up-to-date' },
      });
      expect(created.body.base.yaml).toBe(scene.v2.text);
      expect(created.body.proposed.yaml).toBe(preview.body.resultYaml);
      expect(await versionCount(scene.pricingId)).toBe(before);
    });

    it('Shows a conflict with its three values and refuses it unresolved (CA-13).', async () => {
      const scene = await forkScene({ current: goldAt(20), proposal: both(goldAt(30), platinumAt(50)) });

      const preview = await previewFork(scene.forker.token, scene.forkId);
      expect(preview.body.outcome).toBe('conflicts');
      expect(preview.body.conflicts).toEqual([expect.objectContaining({
        id: GOLD_PRICE, label: 'plans.GOLD.price', section: 'plans', entry: 'GOLD', scope: 'value',
        base: { present: true, yaml: TEMPLATE_GOLD_PRICE },
        current: { present: true, yaml: '20\n' },
        proposal: { present: true, yaml: '30\n' },
      })]);

      const unresolved = await proposeFork(scene.forker.token, scene.forkId, preview.body);
      expect(unresolved.status).toBe(409);
      expect(unresolved.body).toMatchObject({ code: 'UNRESOLVED_CONFLICTS', conflictIds: [GOLD_PRICE] });
      expect(await pullRequestCount(scene.pricingId)).toBe(0);
    });

    it('Keeps the current value of a conflict resolved with "Keep current" (CA-13).', async () => {
      const scene = await forkScene({ current: goldAt(20), proposal: both(goldAt(30), platinumAt(50)) });

      const created = await proposeFromScene(scene, { [GOLD_PRICE]: 'current' });

      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(docOf(created.body.proposed.yaml).plans).toMatchObject({ GOLD: { price: 20 }, PLATINUM: { price: 50 } });
    });

    it('Takes the fork\'s value of a conflict resolved with "Use proposal" (CA-13).', async () => {
      const scene = await forkScene({ current: goldAt(20), proposal: both(goldAt(30), platinumAt(50)) });

      const created = await proposeFromScene(scene, { [GOLD_PRICE]: 'proposal' });

      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(docOf(created.body.proposed.yaml).plans).toMatchObject({ GOLD: { price: 30 }, PLATINUM: { price: 50 } });
    });

    it('Refuses a preview older than a new public version, naming it, and not one older than a private version (CA-14).', async () => {
      const scene = await forkScene();
      const stale = await previewFork(scene.forker.token, scene.forkId);
      await publish(scene.owner.token, scene.organizationId, { name: scene.name, slug: scene.slug, version: '3.0.0-private', isPrivate: true, change: both(V2, platinumAt(40)) });

      const overPrivate = await proposeFork(scene.forker.token, scene.forkId, stale.body);
      expect(overPrivate.status, JSON.stringify(overPrivate.body)).toBe(201);
      expect(overPrivate.body.base.versionId).toBe(scene.v2.id);

      const other = await forkScene();
      const old = await previewFork(other.forker.token, other.forkId);
      const v3 = await publish(other.owner.token, other.organizationId, { name: other.name, slug: other.slug, version: '3.0.0', change: both(V2, platinumAt(40)) });
      const refused = await proposeFork(other.forker.token, other.forkId, old.body);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'BASE_NOT_LATEST', latest: { id: v3.id, version: '3.0.0' } });
      expect(await pullRequestCount(other.pricingId)).toBe(0);
    });

    it('Has nothing to propose when the parent already has the fork\'s changes (CA-15).', async () => {
      const scene = await forkScene({ current: goldAt(30), proposal: goldAt(30) });

      const preview = await previewFork(scene.forker.token, scene.forkId);
      expect(preview.body.outcome).toBe('no-changes');
      const refused = await proposeFork(scene.forker.token, scene.forkId, preview.body);

      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('NO_CHANGES');
      expect(await pullRequestCount(scene.pricingId)).toBe(0);
    });

    it('Proposes a fork of a fork to the fork it was made from (CA-16).', async () => {
      const scene = await forkScene();
      const { user: third, organizationId: thirdOrganizationId } = await createAndLoginUser('USER');
      const grandchild = await forkPricingIntoOrganization({
        token: third.token, sourceOrganizationId: scene.forkOrganizationId, sourceSlug: scene.fork.slug, sourceVersion: '1.1.0',
        targetOrganizationId: thirdOrganizationId, name: `grandchild_${randomSuffix()}`,
      });
      const grandchildId = String((await PricingMongoose.findById(grandchild.id).lean())!.pricingId);

      const target = await forkTarget(third.token, grandchildId);

      expect(target.body).toMatchObject({ canPropose: true, parent: { pricingId: scene.forkId } });
    });

    it('Answers the same whether the parent is gone or cannot be read (CA-17).', async () => {
      const gone = await forkScene();
      await PricingMongoose.deleteMany({ pricingId: new mongoose.Types.ObjectId(gone.pricingId) });
      const hidden = await forkScene();
      await PricingMongoose.updateMany({ pricingId: new mongoose.Types.ObjectId(hidden.pricingId) }, { $set: { private: true } });

      const answers = [];
      for (const scene of [gone, hidden]) {
        const target = await forkTarget(scene.forker.token, scene.forkId);
        const preview = await previewFork(scene.forker.token, scene.forkId);
        const proposed = await proposeFork(scene.forker.token, scene.forkId, { previewToken: 'x.y' });
        expect([target.status, preview.status, proposed.status]).toEqual([200, 404, 404]);
        answers.push([target.body, preview.body, proposed.body]);
      }

      expect(answers[0]).toEqual(answers[1]);
      expect(answers[0][0]).toEqual({ canPropose: false, reason: 'PARENT_UNAVAILABLE' });
      expect(answers[0][2]).toEqual({ error: expect.any(String), code: 'PARENT_UNAVAILABLE' });
    });

    it('Refuses who may read the fork but not publish versions of it (CA-18).', async () => {
      const scene = await forkScene();
      const reader = await outsider();

      const responses = [
        await forkTarget(reader.token, scene.forkId),
        await previewFork(reader.token, scene.forkId),
        await proposeFork(reader.token, scene.forkId, { previewToken: 'x.y' }),
      ];

      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN');
      }
      // Who may not even read the fork is told it does not exist.
      await PricingMongoose.updateMany({ pricingId: new mongoose.Types.ObjectId(scene.forkId) }, { $set: { private: true } });
      expect((await forkTarget(reader.token, scene.forkId)).status).toBe(404);
    });

    it('Shows the maintainers a proposal made from private versions of a fork without naming them (CA-19).', async () => {
      const scene = await pricingWithPrivateLatest();
      const forker = await memberOf(scene.organizationId, scene.slug, { GET: true, PUT: false, DELETE: false, CREATE: false });
      const forkOrganization = await createTestOrganization(forker.token);
      const fork = await forkPricingIntoOrganization({
        token: forker.token, sourceOrganizationId: scene.organizationId, sourceSlug: scene.slug, sourceVersion: scene.v3.version,
        targetOrganizationId: forkOrganization.id, name: `fork_${randomSuffix()}`,
      });
      const forkBase = (await PricingMongoose.findById(fork.id).lean())!;
      expect(forkBase.private).toBe(true);
      const forkId = String(forkBase.pricingId);
      const f2 = await publish(forker.token, forkOrganization.id, {
        name: fork.name, slug: fork.slug, version: '3.5.0', isPrivate: true, change: both(V2, V3_ONLY, platinumAt(55)),
      });

      const created = await proposeFromScene({ forker, forkId });
      expect(created.status, JSON.stringify(created.body)).toBe(201);

      const answers = [await list(scene.owner.token, scene.pricingId), await detail(scene.owner.token, created.body.id)];
      expect(docOf(answers[1].body.proposed.yaml).plans.PLATINUM.price).toBe(55);
      expect(answers[1].body.origin).toBeUndefined();
      expect(answers.map(answer => leaks(answer, [fork.id, f2.id])).flat()).toEqual([]);
    });

    it('Reads the base from the fork\'s own copy, and changes no file of either pricing (CA-20).', async () => {
      const scene = await forkScene();
      // v1 deleted from P and published again with the same label and other content.
      const deleted = await request(app()).delete(`${BASE_PATH}/pricings/${scene.organizationId}/${scene.slug}/1.0.0`).set(bearer(scene.owner.token));
      expect(deleted.status).toBe(200);
      const recreated = await publish(scene.owner.token, scene.organizationId, { name: scene.name, slug: scene.slug, version: '1.0.0', change: both(V2, platinumAt(70)) });
      const versionIds = [scene.v2.id, recreated.id, scene.fork.id, scene.f2.id];
      const hashes = await Promise.all(versionIds.map(hashOf));

      const preview = await previewFork(scene.forker.token, scene.forkId);
      expect(preview.body).toMatchObject({ base: { id: scene.fork.id }, target: { id: recreated.id }, conflicts: [] });
      expect(docOf(preview.body.resultYaml).plans).toMatchObject({ GOLD: { price: 30 }, PLATINUM: { price: 70 } });
      expect((await proposeFork(scene.forker.token, scene.forkId, preview.body)).status).toBe(201);

      expect(await Promise.all(versionIds.map(hashOf))).toEqual(hashes);
    });

    it('Refuses an invalid combination with the parser\'s own words, never as 401 or 404 (CA-28).', async () => {
      const feature = 'Unauthorized not found';
      const scene = await forkScene({
        initial: withFeature(feature),
        current: doc => {
          delete doc.features[feature];
        },
        proposal: doc => {
          doc.usageLimits.maxPets.linkedFeatures = [...(doc.usageLimits.maxPets.linkedFeatures ?? []), feature];
        },
      });
      const linked = JSON.stringify(['usageLimits', 'maxPets', 'linkedFeatures']);

      const preview = await previewFork(scene.forker.token, scene.forkId, { [linked]: 'proposal' });
      expect(preview.body.conflicts.map((conflict: any) => conflict.id)).toEqual([linked]);
      expect(preview.body.validation).toMatchObject({ ok: false, error: expect.stringContaining(feature) });

      const refused = await proposeFork(scene.forker.token, scene.forkId, preview.body, { resolutions: { [linked]: 'proposal' } });
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ code: 'INVALID_PRICING', error: expect.stringContaining(feature) });
      expect(await pullRequestCount(scene.pricingId)).toBe(0);
    });

    it('Takes a result typed by hand over the resolutions, and refuses unknown ones (CA-29).', async () => {
      const scene = await forkScene({ current: goldAt(20), proposal: both(goldAt(30), platinumAt(50)) });
      const preview = await previewFork(scene.forker.token, scene.forkId);

      const unknown = await proposeFork(scene.forker.token, scene.forkId, preview.body, {
        resolutions: { [GOLD_PRICE]: 'current', '["plans","NOPE"]': 'proposal' },
      });
      expect(unknown.status).toBe(422);
      expect(unknown.body).toMatchObject({ code: 'UNKNOWN_RESOLUTION', conflictIds: ['["plans","NOPE"]'] });
      expect(await pullRequestCount(scene.pricingId)).toBe(0);

      const manualYaml = pricingYaml('Typed by hand', '1.2.0', both(goldAt(25), platinumAt(50)));
      const manual = await proposeFork(scene.forker.token, scene.forkId, preview.body, { resolutions: { [GOLD_PRICE]: 'proposal' }, manualYaml });
      expect(manual.status, JSON.stringify(manual.body)).toBe(201);
      expect(manual.body.warnings).toContainEqual({ code: 'MANUAL_OVERRIDE' });
      expect(docOf(manual.body.proposed.yaml)).toMatchObject({ saasName: scene.name, plans: { GOLD: { price: 25 } } });
      // A result typed by hand is not what the fork had.
      expect(manual.body.origin.editedAfterProposal).toBe(true);
    });

    it('Compares a fork in older syntaxes once upgraded, and writes the result in the latest one (CA-69).', async () => {
      const scene = await forkScene({ current: goldAt(20), proposal: V2 });
      const raw: any = yaml.load(readFileSync(path.resolve(process.cwd(), 'public', 'static', 'pricings', 'templates', 'petclinic.yml'), 'utf8'));
      // The same pricing as P@v1 plus v2's change, in syntax 2.1 (with TIME_DRIVEN usage limits).
      const old = { ...raw, saasName: scene.fork.name, version: '1.1.0', syntaxVersion: '2.1' };
      old.plans.BASIC.price = 1;
      old.usageLimits.maxVisitsPerMonthAndPet = { ...old.usageLimits.maxVisitsPerMonthAndPet, type: 'TIME_DRIVEN' };
      delete old.usageLimits.maxVisitsPerMonthAndPet.period;
      await fsp.writeFile(await fileOf(scene.f2.id), yaml.dump(old), 'utf8');

      const preview = await previewFork(scene.forker.token, scene.forkId);

      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      expect(preview.body).toMatchObject({ outcome: 'merged', conflicts: [], validation: { ok: true } });
      expect(preview.body.warnings).toContainEqual({ code: 'SYNTAX_UPGRADED' });
      const result = docOf(preview.body.resultYaml);
      expect(result).toMatchObject({ syntaxVersion: '3.1', plans: { BASIC: { price: 1 }, GOLD: { price: 20 } } });
      expect(result.usageLimits.maxVisitsPerMonthAndPet).toMatchObject({ type: 'RENEWABLE', period: { value: 1, unit: 'MONTH' } });
    });

    it('Refuses a pricing that names no pricing it was forked from (CA-71).', async () => {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const plain = await publish(owner.token, organizationId, { name: `pr_${randomSuffix()}`, version: '1.0.0' });

      expect((await forkTarget(owner.token, plain.pricingId)).body).toEqual({ canPropose: false, reason: 'NOT_A_FORK' });
      for (const response of [await previewFork(owner.token, plain.pricingId), await proposeFork(owner.token, plain.pricingId, { previewToken: 'x.y' })]) {
        expect(response.status).toBe(422);
        expect(response.body.code).toBe('NOT_A_FORK');
      }
    });

    it('Has no public version of the parent to propose to: 409 for who reads its private ones, unavailable for anyone else (CA-72).', async () => {
      const scene = await forkScene();
      await PricingMongoose.updateMany({ pricingId: new mongoose.Types.ObjectId(scene.pricingId) }, { $set: { private: true } });
      await createMembership(scene.forker.id, scene.organizationId, 'MEMBER');
      const reader = await createEntityPermission(scene.forker.id, scene.organizationId, 'pricing', scene.slug, { GET: true, PUT: false, DELETE: false, CREATE: false });
      permissionsToDelete.add(String(reader._id ?? reader.id));

      expect((await forkTarget(scene.forker.token, scene.forkId)).body).toMatchObject({ canPropose: false, reason: 'NO_PUBLIC_VERSION' });
      const refused = await proposeFork(scene.forker.token, scene.forkId, { previewToken: 'x.y' });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('NO_PUBLIC_VERSION');

      await EntityPermissionMongoose.deleteOne({ _id: reader._id ?? reader.id });
      await OrganizationMembershipMongoose.deleteMany({ _userId: new mongoose.Types.ObjectId(scene.forker.id), _organizationId: new mongoose.Types.ObjectId(scene.organizationId) });
      expect((await forkTarget(scene.forker.token, scene.forkId)).body).toEqual({ canPropose: false, reason: 'PARENT_UNAVAILABLE' });
      const unavailable = await proposeFork(scene.forker.token, scene.forkId, { previewToken: 'x.y' });
      expect(unavailable.status).toBe(404);
      expect(unavailable.body.code).toBe('PARENT_UNAVAILABLE');
    });

    it('Takes a proposal that only reorders plans, and a conflict when both sides reorder them differently (CA-94).', async () => {
      const reordered = await forkScene({ current: reorderPlans('PLATINUM', 'GOLD', 'BASIC'), proposal: reorderPlans('GOLD', 'BASIC', 'PLATINUM') });
      const preview = await previewFork(reordered.forker.token, reordered.forkId);
      expect(preview.body.conflicts).toEqual([expect.objectContaining({ id: JSON.stringify(['plans']), scope: 'order' })]);

      // One side reorders and the other changes a price: the new order stays.
      const combined = await forkScene({ current: reorderPlans('PLATINUM', 'GOLD', 'BASIC'), proposal: goldAt(30) });
      const merged = await previewFork(combined.forker.token, combined.forkId);
      expect(merged.body.conflicts).toEqual([]);
      expect(Object.keys(docOf(merged.body.resultYaml).plans)).toEqual(['PLATINUM', 'GOLD', 'BASIC']);

      // A text that only reorders the plans is a proposal.
      const external = await outsider();
      const onlyOrder = await open(external.token, {
        title: 'Order', source: textSource(combined.pricingId, combined.v2.id, pricingYaml(combined.name, '3.0.0', reorderPlans('GOLD', 'PLATINUM', 'BASIC'))),
      });
      expect(onlyOrder.status, JSON.stringify(onlyOrder.body)).toBe(201);
    });
  });

  describe('Proposing again from the same fork', { timeout: 30000 }, () => {
    it('Replaces the proposal of its author\'s open pull request (CA-76).', async () => {
      const scene = await forkScene();
      const first = await proposeFromScene(scene);
      expect(first.status).toBe(201);
      await publish(scene.owner.token, scene.organizationId, { name: scene.name, slug: scene.slug, version: '3.0.0', change: both(V2, platinumAt(40)) });
      const f3 = await publishFork(scene, '1.2.0', both(goldAt(30), platinumAt(60)));
      const latest = await PricingMongoose.findOne({ pricingId: new mongoose.Types.ObjectId(scene.pricingId), version: '3.0.0' }).lean();

      const target = await forkTarget(scene.forker.token, scene.forkId);
      expect(target.body.openPullRequest).toEqual({ id: first.body.id, number: first.body.number, proposalRevision: 1 });
      const preview = await previewFork(scene.forker.token, scene.forkId, { [JSON.stringify(['plans', 'PLATINUM', 'price'])]: 'proposal' });
      expect(preview.body.existingPullRequest).toEqual({ id: first.body.id, number: first.body.number, proposalRevision: 1 });
      const again = await proposeFork(scene.forker.token, scene.forkId, preview.body, {
        title: 'Again', resolutions: { [JSON.stringify(['plans', 'PLATINUM', 'price'])]: 'proposal' },
      });

      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body).toMatchObject({
        updated: true, id: first.body.id, number: first.body.number, title: 'Again', proposalRevision: 2,
        base: { versionId: String(latest!._id), version: '3.0.0' },
        origin: { versionId: f3.id, version: '1.2.0' },
      });
      expect(docOf(again.body.proposed.yaml).plans).toMatchObject({ GOLD: { price: 30 }, PLATINUM: { price: 60 } });
      expect(await pullRequestCount(scene.pricingId)).toBe(1);
    });

    it('Opens one pull request for two proposals sent at once, with and without the unique index (CA-96).', async () => {
      const proposeTwice = async () => {
        const scene = await forkScene();
        const preview = await previewFork(scene.forker.token, scene.forkId);
        const responses = await Promise.all([1, 2].map(() => proposeFork(scene.forker.token, scene.forkId, preview.body)));
        expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
        expect(await pullRequestCount(scene.pricingId)).toBe(1);
      };

      await proposeTwice();
      const indexes = await mongoose.connection.db!.collection(COLLECTION).indexes();
      const perFork = indexes.find(index => 'origin.pricingId' in index.key)!;
      await mongoose.connection.db!.collection(COLLECTION).dropIndex(perFork.name!);
      try {
        await proposeTwice();
      } finally {
        await up(mongoose.connection);
      }
    });

    it('Replaces, rather than numbers again, the pull request another request opened from the fork first (CA-96).', async () => {
      const scene = await forkScene();
      const preview = await previewFork(scene.forker.token, scene.forkId);
      const pullRequests: PricingPullRequestRepository = appContainer.resolve('pricingPullRequestRepository');
      const create = pullRequests.create.bind(pullRequests);
      // Another request opens it between the look-up and the creation.
      const spy = vi.spyOn(pullRequests, 'create').mockImplementationOnce(async data => {
        await create(data);
        return create(data);
      });

      try {
        const response = await proposeFork(scene.forker.token, scene.forkId, preview.body);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toMatchObject({ updated: true, number: 1 });
      } finally {
        spy.mockRestore();
      }
      expect(await pullRequestCount(scene.pricingId)).toBe(1);
    });

    it('Lets only the author replace the open pull request from the fork, from a preview of its current proposal (CA-100).', async () => {
      const scene = await forkScene();
      const first = await proposeFromScene(scene);
      const colleague = await memberOf(scene.forkOrganizationId, scene.fork.slug, { GET: true, PUT: false, DELETE: false, CREATE: true });

      const target = await forkTarget(colleague.token, scene.forkId);
      expect(target.body).toMatchObject({ canPropose: false, reason: 'PULL_REQUEST_EXISTS', openPullRequest: { number: first.body.number } });
      expect(target.body.openPullRequest).toEqual({ number: first.body.number });
      const refused = await proposeFork(colleague.token, scene.forkId, { previewToken: 'x.y' });
      expect(refused.status).toBe(409);
      expect(refused.body).toEqual({ error: expect.any(String), code: 'PULL_REQUEST_EXISTS', number: first.body.number });
      expect(JSON.stringify([target.body, refused.body])).not.toContain(first.body.id);

      // The author edits the proposal by hand: an older preview of the fork may not overwrite it.
      const old = await previewFork(scene.forker.token, scene.forkId);
      const edited = await edit(scene.forker.token, first.body.id, { proposedYaml: pricingYaml(scene.name, '1.1.0', both(V2, goldAt(31))) });
      expect(edited.body.proposalRevision).toBe(2);
      const stale = await proposeFork(scene.forker.token, scene.forkId, old.body);
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('PREVIEW_STALE');
      expect(docOf((await detail(scene.forker.token, first.body.id)).body.proposed.yaml).plans.GOLD.price).toBe(31);

      const fresh = await previewFork(scene.forker.token, scene.forkId);
      const replaced = await proposeFork(scene.forker.token, scene.forkId, fresh.body);
      expect(replaced.status).toBe(200);
      expect(replaced.body).toMatchObject({ proposalRevision: 3, origin: { editedAfterProposal: false } });
    });
  });

  describe('Where the fork\'s changes are counted from', { timeout: 30000 }, () => {
    it('Proposes to the pricing the newest readable version was forked from (CA-77, F-parent).', async () => {
      const scene = await forkScene();
      const other = await forkScene();
      // The fork's latest version names another pricing (inserted as a later sync would).
      await PricingMongoose.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(scene.f2.id) },
        { $set: { forkedFrom: { pricingId: new mongoose.Types.ObjectId(other.pricingId), version: '2.0.0', name: other.name, slug: other.slug } } }
      );

      expect((await forkTarget(scene.forker.token, scene.forkId)).body.parent.pricingId).toBe(other.pricingId);
    });

    it('Starts from the newest version of the fork copied from the parent (CA-77, F-base).', async () => {
      const scene = await forkScene({ current: goldAt(20), proposal: goldAt(20) });
      // v_b: a later copy of P, with P@v2's change.
      await PricingMongoose.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(scene.f2.id) },
        { $set: { forkedFrom: { pricingId: new mongoose.Types.ObjectId(scene.pricingId), version: '2.0.0', name: scene.name, slug: scene.slug } } }
      );
      await publishFork(scene, '1.2.0', goldAt(25));

      const preview = await previewFork(scene.forker.token, scene.forkId);

      // From the first copy (P@v1), GOLD would clash: 20 against 25.
      expect(preview.body.base.id).toBe(scene.f2.id);
      expect(preview.body.conflicts).toEqual([]);
      expect(docOf(preview.body.resultYaml).plans.GOLD.price).toBe(25);
    });

    it('Only counts the versions of the fork the caller may read (CA-77, F-readable).', async () => {
      const scene = await forkScene();
      const hiddenLabel = `1.9.0-hidden-${randomSuffix()}`;
      const hidden = await publishFork(scene, hiddenLabel, both(goldAt(30), platinumAt(99)), true);
      const colleague = await memberOf(scene.forkOrganizationId, scene.fork.slug, { GET: false, PUT: false, DELETE: false, CREATE: true });

      const answers = [await forkTarget(colleague.token, scene.forkId), await previewFork(colleague.token, scene.forkId)];
      expect(docOf(answers[1].body.resultYaml).plans.PLATINUM.price).not.toBe(99);
      answers.push(await proposeFork(colleague.token, scene.forkId, answers[1].body));
      expect(answers[2].status, JSON.stringify(answers[2].body)).toBe(201);
      answers.push(await detail(colleague.token, answers[2].body.id));

      expect(answers[2].body.origin.versionId).toBe(scene.f2.id);
      expect(answers.map(answer => leaks(answer, [hidden.id, hiddenLabel])).flat()).toEqual([]);
    });

    it('Starts from what the parent last took in from the fork, and says it was merged before (CA-77, CA-97).', async () => {
      const scene = await forkScene({ current: goldAt(20), proposal: both(goldAt(30), platinumAt(50)) });
      /** Proposes the fork and records it as merged into a new public version of P with the proposal. */
      const proposeAndMerge = async (resolutions: Record<string, string>, version: string) => {
        const created = await proposeFromScene(scene, resolutions);
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const published = await publish(scene.owner.token, scene.organizationId, { name: scene.name, slug: scene.slug, version, change: doc => {
          Object.assign(doc, docOf(created.body.proposed.yaml), { saasName: scene.name, version });
        } });
        const lock = await repository.reserveForMerge(created.body.id, 1, scene.owner.id);
        await repository.markMerged(created.body.id, lock!.id, {
          byId: scene.owner.id, at: new Date(), versionId: published.id, version, proposalRevision: 1,
        });
        return created.body;
      };

      // GOLD clashes; the maintainer keeps 20.
      const first = await proposeAndMerge({ [GOLD_PRICE]: 'current' }, '3.0.0');
      const f3 = await publishFork(scene, '1.2.0', both(goldAt(30), platinumAt(50), doc => {
        doc.plans.BASIC.price = 3;
      }));
      const fromMerged = await previewFork(scene.forker.token, scene.forkId);
      expect(fromMerged.body.base.id).toBe(scene.f2.id);
      expect(fromMerged.body.conflicts).toEqual([]);
      expect(docOf(fromMerged.body.resultYaml).plans).toMatchObject({ BASIC: { price: 3 }, GOLD: { price: 20 }, PLATINUM: { price: 50 } });
      expect(fromMerged.body.warnings).toContainEqual({ code: 'PREVIOUSLY_MERGED', number: first.number });

      // A second merge: the newest merged proposal is the base, and the older one while the newer's version is gone.
      const second = await proposeAndMerge({}, '4.0.0');
      await publishFork(scene, '1.3.0', both(goldAt(30), platinumAt(50), doc => {
        doc.plans.BASIC.price = 3;
      }));
      const fromNewest = await previewFork(scene.forker.token, scene.forkId);
      expect(fromNewest.body.base.id).toBe(f3.id);
      expect(fromNewest.body.warnings).toContainEqual({ code: 'PREVIOUSLY_MERGED', number: second.number });
      await PricingMongoose.deleteOne({ _id: f3.id });
      expect((await previewFork(scene.forker.token, scene.forkId)).body.base.id).toBe(scene.f2.id);

      // Once no merged version is left in the fork, the first copy of P is the base and the conflict comes back.
      await PricingMongoose.deleteOne({ _id: scene.f2.id });
      const fromCopy = await previewFork(scene.forker.token, scene.forkId);
      expect(fromCopy.body.base.id).toBe(scene.fork.id);
      expect(fromCopy.body.conflicts.map((conflict: any) => conflict.id)).toEqual([GOLD_PRICE]);
      expect(fromCopy.body.warnings).toContainEqual({ code: 'PREVIOUSLY_MERGED', number: second.number });
    });
  });

  // ---------------------------------------------------------------------------
  // Previews of texts
  // ---------------------------------------------------------------------------

  describe('Previewing a text written on an older version', { timeout: 30000 }, () => {
    it('Merges it with the latest public version, which it can then be proposed on (CA-23).', async () => {
      const scene = await pricingWithPrivateLatest();
      const external = await outsider();
      const written = pricingYaml(scene.name, '9.0.0', goldAt(7));
      const refused = await open(external.token, { title: 'Old', source: textSource(scene.pricingId, scene.v1.id, written) });
      expect(refused.body.code).toBe('BASE_NOT_LATEST');

      const preview = await previews(external.token, { source: textSource(scene.pricingId, scene.v1.id, written) });

      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      expect(preview.body).toMatchObject({
        base: { id: scene.v1.id, version: '1.0.0' }, target: { id: scene.v2.id, version: '2.0.0' },
        outcome: 'merged', conflicts: [], validation: { ok: true }, suggestedVersion: '9.0.0',
      });
      expect(docOf(preview.body.resultYaml).plans).toMatchObject({ BASIC: { price: 1 }, GOLD: { price: 7 } });
      expect(leaks(preview, scene.markers)).toEqual([]);
      const created = await open(external.token, { title: 'On top', source: textSource(scene.pricingId, scene.v2.id, preview.body.resultYaml) });
      expect(created.status).toBe(201);
      expect(docOf(created.body.proposed.yaml).plans.GOLD.price).toBe(7);
    });
  });

  // ---------------------------------------------------------------------------
  // Updating to the latest public version
  // ---------------------------------------------------------------------------

  describe('Bringing a pull request up to the latest public version', { timeout: 30000 }, () => {
    /** An external author's pull request on v2 (GOLD at 7.5), behind v4 (GOLD at 8, PLATINUM at 20), with the private v3 in between. */
    async function behindScene() {
      const scene = await pricingWithPrivateLatest();
      const author = await outsider();
      const created = await openOn(author, scene, scene.v2, goldAt(7.5));
      const second = await openOn(author, scene, scene.v2, platinumAt(12));
      const v4 = await publish(scene.owner.token, scene.organizationId, {
        name: scene.name, slug: scene.slug, version: '4.0.0', change: both(V2, goldAt(8), platinumAt(20)),
      });
      return { ...scene, author, created, second, v4 };
    }

    it('Merges the latest public version into it, as its preview showed (CA-29).', async () => {
      const scene = await behindScene();
      const answers = [];

      const preview = await mergePreview(scene.author.token, scene.created.id, { purpose: 'update' });
      answers.push(preview);
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      expect(preview.body).toMatchObject({
        base: { id: scene.v2.id }, target: { id: scene.v4.id, version: '4.0.0' }, outcome: 'conflicts',
        conflicts: [expect.objectContaining({ id: GOLD_PRICE, current: { present: true, yaml: '8\n' }, proposal: { present: true, yaml: '7.5\n' } })],
      });

      const unresolved = await updateToLatest(scene.author.token, scene.created.id, { previewToken: preview.body.previewToken });
      expect(unresolved.status).toBe(409);
      expect(unresolved.body).toMatchObject({ code: 'UNRESOLVED_CONFLICTS', conflictIds: [GOLD_PRICE] });
      const unknown = await updateToLatest(scene.author.token, scene.created.id, {
        previewToken: preview.body.previewToken, resolutions: { [GOLD_PRICE]: 'proposal', '["other"]': 'current' },
      });
      expect(unknown.status).toBe(422);
      expect(unknown.body.code).toBe('UNKNOWN_RESOLUTION');
      answers.push(unresolved, unknown);

      const updated = await updateToLatest(scene.author.token, scene.created.id, {
        previewToken: preview.body.previewToken, resolutions: { [GOLD_PRICE]: 'proposal' },
      });
      answers.push(updated);
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body).toMatchObject({
        base: { versionId: scene.v4.id, version: '4.0.0' }, proposalRevision: 2, state: { kind: 'up-to-date' },
      });
      expect(updated.body.base.yaml).toBe(scene.v4.text);
      expect(docOf(updated.body.proposed.yaml).plans).toMatchObject({ GOLD: { price: 7.5 }, PLATINUM: { price: 20 } });

      const again = await updateToLatest(scene.author.token, scene.created.id, {
        previewToken: preview.body.previewToken, resolutions: { [GOLD_PRICE]: 'proposal' },
      });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('PULL_REQUEST_UP_TO_DATE');
      answers.push(again);
      // Nothing about the private v3 reaches the author (CA-46).
      expect(answers.map(answer => leaks(answer, scene.markers)).flat()).toEqual([]);
    });

    it('Takes a result typed by hand, and tells who is not the author or a maintainer nothing.', async () => {
      const scene = await behindScene();
      const preview = await mergePreview(scene.author.token, scene.created.id, { purpose: 'update' });
      const manualYaml = pricingYaml('By hand', '9.1.0', both(V2, goldAt(9), platinumAt(20)));

      expect((await mergePreview(scene.owner.token, scene.created.id, { purpose: 'update' })).status).toBe(403);
      expect((await updateToLatest(scene.owner.token, scene.created.id, { previewToken: preview.body.previewToken })).status).toBe(403);
      const stranger = await outsider();
      expect((await mergePreview(stranger.token, scene.created.id, { purpose: 'update' })).status).toBe(404);
      expect((await updateToLatest(stranger.token, scene.created.id, { previewToken: preview.body.previewToken })).status).toBe(404);

      const updated = await updateToLatest(scene.author.token, scene.created.id, { previewToken: preview.body.previewToken, manualYaml });
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body.warnings).toContainEqual({ code: 'MANUAL_OVERRIDE' });
      expect(docOf(updated.body.proposed.yaml)).toMatchObject({ saasName: scene.name, version: '9.1.0', plans: { GOLD: { price: 9 } } });
    });

    it('Refuses a preview token of another pull request, purpose or user, or altered in any way (CA-29, CA-81).', async () => {
      const scene = await behindScene();
      const other = scene.second;
      const resolutions = { [GOLD_PRICE]: 'proposal' };
      const own = (await mergePreview(scene.author.token, scene.created.id, { purpose: 'update' })).body.previewToken;
      const [body, mac] = own.split('.');
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      const tokens = [
        // Another pull request's, and another user's for another purpose.
        (await mergePreview(scene.author.token, other.id, { purpose: 'update' })).body.previewToken,
        (await mergePreview(scene.owner.token, scene.created.id, { purpose: 'merge' })).body.previewToken,
        // A forged signature, and a payload changed under the real one.
        `${body}.${Buffer.alloc(32).toString('base64url')}`,
        `${Buffer.from(JSON.stringify({ ...payload, viewerId: scene.owner.id })).toString('base64url')}.${mac}`,
        'not a token',
      ];

      for (const previewToken of tokens) {
        const response = await updateToLatest(scene.author.token, scene.created.id, { previewToken, resolutions });
        expect(response.status, previewToken).toBe(409);
        expect(response.body.code).toBe('PREVIEW_STALE');
      }
      expect((await PricingPullRequestMongoose.findById(scene.created.id).lean())!.proposalRevision).toBe(1);
    });

    it('Refuses a preview older than a newer public version, naming it; a new title leaves it valid (CA-14).', async () => {
      const scene = await behindScene();
      const resolutions = { [GOLD_PRICE]: 'proposal' };
      const preview = await mergePreview(scene.author.token, scene.created.id, { purpose: 'update' });
      const v5 = await publish(scene.owner.token, scene.organizationId, {
        name: scene.name, slug: scene.slug, version: '5.0.0', change: both(V2, goldAt(8), platinumAt(21)),
      });

      const newer = await updateToLatest(scene.author.token, scene.created.id, { previewToken: preview.body.previewToken, resolutions });
      expect(newer.status).toBe(409);
      expect(newer.body).toMatchObject({ code: 'BASE_NOT_LATEST', latest: { id: v5.id, version: '5.0.0' } });

      const fresh = await mergePreview(scene.author.token, scene.created.id, { purpose: 'update' });
      await edit(scene.author.token, scene.created.id, { title: 'Only the title' });
      expect((await updateToLatest(scene.author.token, scene.created.id, { previewToken: fresh.body.previewToken, resolutions })).status).toBe(200);
    });

    it('Gives a maintainer the merge with the latest version, private or not.', async () => {
      const scene = await pricingWithPrivateLatest();
      const author = await outsider();
      const created = await open(author.token, {
        title: 'Same label', source: textSource(scene.pricingId, scene.v2.id, pricingYaml(scene.name, scene.v3.version, both(V2, platinumAt(12)))),
      });

      const preview = await mergePreview(scene.owner.token, created.body.id, { purpose: 'merge' });
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      expect(preview.body).toMatchObject({
        target: { id: scene.v3.id, version: scene.v3.version, private: true },
        outcome: 'merged', conflicts: [], versionTaken: true, defaults: { private: true },
      });
      expect(docOf(preview.body.resultYaml).plans).toMatchObject({ GOLD: { price: 987.65 }, PLATINUM: { price: 12 } });

      const refused = await mergePreview(author.token, created.body.id, { purpose: 'merge' });
      expect(refused.status).toBe(403);
      expect(leaks(refused, scene.markers)).toEqual([]);
      expect((await mergePreview((await outsider()).token, created.body.id, { purpose: 'merge' })).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Limits of the inputs and what is written
  // ---------------------------------------------------------------------------

  describe('Proposals that are too large or too complex', { timeout: 30000 }, () => {
    it('Refuses them in every text a user sends, writing nothing (CA-79).', async () => {
      const scene = await behindScene2();
      const valid = pricingYaml(scene.name, '9.0.0', both(V2, goldAt(7)));
      const aliases = [
        'l0: &l0 [x, x, x, x, x, x, x, x, x]',
        ...Array.from({ length: 8 }, (_, i) => `l${i + 1}: &l${i + 1} [${Array(9).fill(`*l${i}`).join(', ')}]`),
      ].join('\n');
      const bad = [
        { text: `${valid}\n# ${'x'.repeat(1024 * 1024)}\n`, status: 413, code: 'PRICING_TOO_LARGE' },
        { text: aliases, status: 422, code: 'PRICING_TOO_COMPLEX' },
        // A long string used through many aliases: few values, hundreds of megabytes once copied.
        { text: `${valid}a: &a "${'x'.repeat(100_000)}"\nb: [${Array(2000).fill('*a').join(', ')}]\n`, status: 422, code: 'PRICING_TOO_COMPLEX' },
        { text: `${valid}__proto__:\n  polluted: true\n`, status: 422, code: 'INVALID_PRICING' },
      ];
      const sends = [
        (text: string) => open(scene.author.token, { title: 'Bad', source: textSource(scene.pricingId, scene.v2.id, text) }),
        (text: string) => edit(scene.author.token, scene.onLatest.id, { proposedYaml: text }),
        (text: string) => proposeFork(scene.fork.forker.token, scene.fork.forkId, { previewToken: 'x.y' }, { manualYaml: text }),
        (text: string) => updateToLatest(scene.author.token, scene.behind.id, { previewToken: 'x.y', manualYaml: text }),
      ];
      const before = { count: await pullRequestCount(scene.pricingId), forkCount: await pullRequestCount(scene.fork.pricingId) };

      for (const { text, status, code } of bad) {
        for (const [index, send] of sends.entries()) {
          const started = Date.now();
          const response = await send(text);
          expect(response.status, `${code} on send ${index}`).toBe(status);
          expect(response.body.code).toBe(code);
          // Measured before anything expands the aliases.
          if (code === 'PRICING_TOO_COMPLEX') expect(Date.now() - started).toBeLessThan(1000);
        }
      }

      expect(await pullRequestCount(scene.pricingId)).toBe(before.count);
      expect(await pullRequestCount(scene.fork.pricingId)).toBe(before.forkCount);
      const stored = await PricingPullRequestMongoose.find({ _id: { $in: [scene.onLatest.id, scene.behind.id] } }).lean();
      expect(stored.map(pullRequest => pullRequest.proposalRevision)).toEqual([1, 1]);
    });

    it('Writes no file for previews, pull requests, edits or updates (CA-79b).', async () => {
      const scene = await behindScene2();
      const folders = [scene.name, scene.organizationId, scene.fork.name, scene.fork.fork.name, scene.fork.organizationId, scene.fork.forkOrganizationId];
      const files = await uploadedFiles(folders);
      expect(files.inside.length).toBeGreaterThan(0);

      const preview = await previewFork(scene.fork.forker.token, scene.fork.forkId);
      expect((await proposeFork(scene.fork.forker.token, scene.fork.forkId, preview.body)).status).toBe(201);
      expect((await previews(scene.author.token, { source: textSource(scene.pricingId, scene.v1.id, pricingYaml(scene.name, '9.0.0', goldAt(6))) })).status).toBe(200);
      expect((await open(scene.author.token, { title: 'Text', source: textSource(scene.pricingId, scene.v2.id, pricingYaml(scene.name, '9.0.0', both(V2, goldAt(6)))) })).status).toBe(201);
      expect((await edit(scene.author.token, scene.onLatest.id, { proposedYaml: pricingYaml(scene.name, '9.0.0', both(V2, goldAt(5.5))) })).status).toBe(200);
      const update = await mergePreview(scene.author.token, scene.behind.id, { purpose: 'update' });
      expect((await updateToLatest(scene.author.token, scene.behind.id, { previewToken: update.body.previewToken })).status).toBe(200);

      expect(await uploadedFiles(folders)).toEqual(files);
    });

    /** P with an author's pull request on its latest public version v2, another one behind it, and a fork of another pricing. */
    async function behindScene2() {
      const { user: owner, organizationId } = await createAndLoginUser('USER');
      const name = `pr_${randomSuffix()}`;
      const v1 = await publish(owner.token, organizationId, { name, version: '1.0.0' });
      const author = await outsider();
      const pricing = { name, pricingId: v1.pricingId };
      const behind = await openOn(author, pricing, v1, platinumAt(12));
      const v2 = await publish(owner.token, organizationId, { name, slug: v1.slug, version: '2.0.0', change: V2 });
      const onLatest = await openOn(author, pricing, v2, goldAt(7.5));
      const fork = await forkScene();
      return { owner, organizationId, name, pricingId: v1.pricingId, v1, v2, author, behind, onLatest, fork };
    }
  });

  // ---------------------------------------------------------------------------
  // Deleting what a pull request points at
  // ---------------------------------------------------------------------------

  describe('Deleting the pricing, the fork or the author of a pull request', { timeout: 30000 }, () => {
    /** P in a team organization of a new owner, with an outsider's pull request on its latest public version. */
    async function pricingWithPullRequest(versions = 1) {
      const { user: owner } = await createAndLoginUser('USER');
      const organization = await createTestOrganization(owner.token);
      const name = `pr_${randomSuffix()}`;
      let latest = await publish(owner.token, organization.id, { name, version: '1.0.0' });
      for (let index = 2; index <= versions; index++) {
        latest = await publish(owner.token, organization.id, { name, slug: latest.slug, version: `${index}.0.0` });
      }
      const author = await outsider();
      const pullRequest = await openOn(author, { name, pricingId: latest.pricingId }, latest, goldAt(7.5));
      return { owner, organizationId: organization.id, slug: latest.slug, pricingId: latest.pricingId, author, pullRequest };
    }

    const expectGone = async (scene: Awaited<ReturnType<typeof pricingWithPullRequest>>) => {
      expect(await pullRequestCount(scene.pricingId)).toBe(0);
      expect((await detail(scene.author.token, scene.pullRequest.id)).status).toBe(404);
    };

    it('Deletes its pull requests with the pricing, its last version, its collection or its organization (CA-70).', async () => {
      const destroyed = await pricingWithPullRequest(2);
      expect((await request(app()).delete(`${BASE_PATH}/pricings/${destroyed.organizationId}/${destroyed.slug}`).set(bearer(destroyed.owner.token))).status).toBe(200);
      await expectGone(destroyed);

      const lastVersion = await pricingWithPullRequest();
      expect((await request(app()).delete(`${BASE_PATH}/pricings/${lastVersion.organizationId}/${lastVersion.slug}/1.0.0`).set(bearer(lastVersion.owner.token))).status).toBe(200);
      await expectGone(lastVersion);

      const inCollection = await pricingWithPullRequest();
      const collection = await request(app())
        .post(`${BASE_PATH}/collections/${inCollection.organizationId}`)
        .set(bearer(inCollection.owner.token))
        .send({ name: `collection_${randomSuffix()}`, description: 'With the pricing', private: false, pricings: [inCollection.slug] });
      expect(collection.status, JSON.stringify(collection.body)).toBe(201);
      const deletedCollection = await request(app())
        .delete(`${BASE_PATH}/collections/${inCollection.organizationId}/${collection.body.slug}?cascade=true`)
        .set(bearer(inCollection.owner.token));
      expect(deletedCollection.status).toBe(200);
      await expectGone(inCollection);

      const inOrganization = await pricingWithPullRequest();
      expect((await request(app()).delete(`${BASE_PATH}/orgs/${inOrganization.organizationId}`).set(bearer(inOrganization.owner.token))).status).toBe(200);
      await expectGone(inOrganization);
    });

    it('Keeps a pull request whose fork or author is gone, without naming them (CA-70).', async () => {
      const scene = await forkScene();
      const created = await proposeFromScene(scene);
      expect((await detail(scene.owner.token, created.body.id)).body.origin).toMatchObject({ pricingId: scene.forkId });

      expect((await request(app()).delete(`${BASE_PATH}/pricings/${scene.forkOrganizationId}/${scene.fork.slug}`).set(bearer(scene.forker.token))).status).toBe(200);
      const withoutFork = await detail(scene.owner.token, created.body.id);
      expect(withoutFork.body).toMatchObject({ status: 'open', author: { id: scene.forker.id } });
      expect(withoutFork.body.origin).toBeUndefined();

      await deleteTestUser(scene.forker.username);
      const withoutAuthor = await detail(scene.owner.token, created.body.id);
      expect(withoutAuthor.status).toBe(200);
      expect(withoutAuthor.body.author).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Merging: helpers
  // ---------------------------------------------------------------------------

  /** The tag of a pricing's revision (Express gives other answers a weak tag of their body). */
  const PRICING_ETAG = /^"[0-9a-f]{24}\.\d+"$/;

  const mergeOf = (token: string, id: string, body: Record<string, unknown>, ifMatch?: string) => {
    const call = request(app()).post(`${PULL_REQUESTS}/${id}/merge`).set(bearer(token));
    if (ifMatch !== undefined) call.set('If-Match', ifMatch);
    return call.send(body);
  };

  /** Removes what a merge published once the tests end. */
  async function trackMerge(response: { status: number; body: any }) {
    if (response.status !== 200) return;
    const id = response.body.version.id;
    pricingsToDelete.add(id);
    const stored = await PricingMongoose.findById(id).lean();
    if (stored) generatedFilesToDelete.add(requirePricingFile(String(stored.yaml)));
  }

  /** The `merge` preview as `token`'s user sees it. */
  async function mergePreviewOf(token: string, id: string, resolutions?: Record<string, string>) {
    const preview = await mergePreview(token, id, { purpose: 'merge', ...(resolutions ? { resolutions } : {}) });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    return preview.body;
  }

  /** Merges as the merge preview `preview` showed it, with `extra` over its defaults. */
  async function mergeAs(token: string, id: string, preview: any, extra: Record<string, unknown> = {}, ifMatch?: string) {
    const response = await mergeOf(token, id, {
      version: preview.suggestedVersion, private: preview.defaults.private, previewToken: preview.previewToken, ...extra,
    }, ifMatch);
    await trackMerge(response);
    return response;
  }

  /** Previews the merge and merges it as shown. */
  async function mergeAsShown(token: string, id: string, extra: Record<string, unknown> = {}) {
    const preview = await mergePreviewOf(token, id, extra.resolutions as Record<string, string> | undefined);
    return { preview, response: await mergeAs(token, id, preview, extra) };
  }

  /** P in a team organization of a new owner, with v1 and v2 public. */
  async function publicScene() {
    const { user: owner } = await createAndLoginUser('USER');
    const organization = await createTestOrganization(owner.token);
    const name = `pr_${randomSuffix()}`;
    const v1 = await publish(owner.token, organization.id, { name, version: '1.0.0' });
    const v2 = await publish(owner.token, organization.id, { name, slug: v1.slug, version: '2.0.0', change: V2 });
    return { owner, organizationId: organization.id, name, slug: v1.slug, pricingId: v1.pricingId, v1, v2 };
  }

  const pricingUrlOf = (scene: { organizationId: string; slug: string }) => `${BASE_PATH}/pricings/${scene.organizationId}/${scene.slug}`;
  const etagOf = async (scene: { organizationId: string; slug: string }, token: string) =>
    (await request(app()).get(pricingUrlOf(scene)).set(bearer(token))).headers.etag as string | undefined;
  const hashText = (text: string) => createHash('sha256').update(text).digest('hex');

  /** Records the hash of every file `createVersion` publishes, before and after it runs. */
  function watchPublishedFiles() {
    const pricingService = appContainer.resolve('pricingService');
    const createVersion = pricingService.createVersion.bind(pricingService);
    const hashes: Array<{ before: string; after: string }> = [];
    const spy = vi.spyOn(pricingService, 'createVersion').mockImplementation(async (file: any, ...rest: any[]) => {
      const before = hashText(readFileSync(file.path, 'utf8'));
      const result = await (createVersion as any)(file, ...rest);
      hashes.push({ before, after: hashText(readFileSync(file.path, 'utf8')) });
      return result;
    });
    return { hashes, restore: () => spy.mockRestore() };
  }

  /** The lines of `published` that differ from `proposed`, which have as many. */
  const changedLines = (proposed: string, published: string) => {
    const before = proposed.split('\n');
    const after = published.split('\n');
    expect(after).toHaveLength(before.length);
    return after.filter((line, index) => line !== before[index]);
  };

  const pullRequestNotices = async (token: string, pullRequestId?: string) => {
    const response = await request(app()).get(`${BASE_PATH}/notifications`).set(bearer(token));
    return (response.body as any[]).filter(notice =>
      notice.kind === 'PricingPullRequest' && (pullRequestId === undefined || notice.data?.pullRequestId === pullRequestId));
  };
  /** Notifications are sent without awaiting the request that caused them. */
  const settle = () => new Promise(resolve => setTimeout(resolve, 300));
  /** Runs `check` until it passes, for at most five seconds. */
  async function eventually(check: () => Promise<unknown>, timeoutMs = 5000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      try {
        return await check();
      } catch (error) {
        if (Date.now() > until) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Merging
  // ---------------------------------------------------------------------------

  describe('Merging a pull request', { timeout: 30000 }, () => {
    it('Publishes an up-to-date proposal as written but for its name, version and date, in a file of its own (CA-38).', async () => {
      const scene = await publicScene();
      const author = await outsider();
      const proposal = `# Proposed by an outsider\n${pricingYaml(scene.name, '2.1.0', both(V2, goldAt(7.5)))}# Kept as written\n`;
      const created = await open(author.token, { title: 'Raise GOLD', source: textSource(scene.pricingId, scene.v2.id, proposal) });
      expect(created.status).toBe(201);
      const watched = watchPublishedFiles();
      const startedAt = Date.now();

      let merged;
      try {
        merged = await mergeAsShown(scene.owner.token, created.body.id);
      } finally {
        watched.restore();
      }

      expect(merged.preview).toMatchObject({ outcome: 'proposal-only', suggestedVersion: '2.1.0', versionTaken: false, defaults: { private: false } });
      const { response } = merged;
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.version).toEqual({ id: expect.any(String), version: '2.1.0', private: false });
      expect(response.body.pullRequest).toMatchObject({
        status: 'merged', state: { kind: 'merged' }, merged: { versionId: response.body.version.id, version: '2.1.0' },
        permissions: { edit: false, editProposal: false, update: false, close: false, merge: false },
      });
      const stored: any = await PricingMongoose.findById(response.body.version.id).lean();
      expect({ number: stored.mergedFrom.number, prId: String(stored.mergedFrom.prId) }).toEqual({ number: created.body.number, prId: created.body.id });
      expect(stored.forkedFrom).toBeUndefined();
      expect(stored.pricingId.toString()).toBe(scene.pricingId);
      expect(stored.createdAt.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
      expect(stored.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(stored.yaml).toMatch(new RegExp(`^static/pricings/uploaded/${scene.organizationId}/${scene.slug}/2\\.1\\.0-pr-\\d+-[0-9a-f-]{36}\\.yml$`));
      // Written once by the merge: publishing it did not rewrite it.
      expect(watched.hashes).toHaveLength(1);
      expect(watched.hashes[0].after).toBe(watched.hashes[0].before);
      const published = readFileSync(requirePricingFile(String(stored.yaml)), 'utf8');
      const changed = changedLines(created.body.proposed.yaml, published).map(line => line.split(':')[0]);
      expect(changed).toContain('version');
      expect(changed).toContain('createdAt');
      expect(changed.every(key => ['createdAt', 'saasName', 'version'].includes(key)), changed.join()).toBe(true);
      expect(published.startsWith('# Proposed by an outsider\n')).toBe(true);
      expect(published.endsWith('# Kept as written\n')).toBe(true);
      expect(new Date(docOf(published).createdAt).getTime()).toBe(stored.createdAt.getTime());
    });

    it('Publishes proposals written in older syntaxes in the latest one, which publishing does not rewrite (CA-95).', async () => {
      const scene = await publicScene();
      const author = await outsider();
      const raw: any = yaml.load(readFileSync(path.resolve(process.cwd(), 'public', 'static', 'pricings', 'templates', 'petclinic.yml'), 'utf8'));
      // Syntax 2.1, with TIME_DRIVEN usage limits; and 2.0, which has no syntaxVersion and a version that is the syntax's.
      const older = { ...structuredClone(raw), saasName: scene.name, version: '2.1.0', syntaxVersion: '2.1' };
      older.plans.BASIC.price = 1;
      older.plans.GOLD.price = 7.5;
      older.usageLimits.maxVisitsPerMonthAndPet = { ...older.usageLimits.maxVisitsPerMonthAndPet, type: 'TIME_DRIVEN' };
      delete older.usageLimits.maxVisitsPerMonthAndPet.period;
      const oldest = { ...structuredClone(older), version: '2.0' };
      delete oldest.syntaxVersion;
      oldest.plans.GOLD.price = raw.plans.GOLD.price;
      oldest.plans.PLATINUM.price = 99;

      const opened = [];
      for (const [index, text] of [yaml.dump(older), yaml.dump(oldest)].entries()) {
        const created = await open(author.token, { title: `Old syntax ${index}`, source: textSource(scene.pricingId, scene.v2.id, text) });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        expect(created.body.warnings).toEqual([{ code: 'SYNTAX_UPGRADED' }]);
        expect(docOf(created.body.proposed.yaml).syntaxVersion).toBe('3.1');
        opened.push(created);
      }
      // The first one is up to date; the second is merged with it.
      for (const [index, created] of opened.entries()) {
        const watched = watchPublishedFiles();
        try {
          const preview = await mergePreviewOf(scene.owner.token, created.body.id);
          const response = await mergeAs(scene.owner.token, created.body.id, preview, { version: `2.${index + 1}.5` });
          expect(response.status, JSON.stringify(response.body)).toBe(200);
        } finally {
          watched.restore();
        }
        expect(watched.hashes).toHaveLength(1);
        expect(watched.hashes[0].after).toBe(watched.hashes[0].before);
      }
      const latest = docOf(readFileSync(await fileOf((await list(scene.owner.token, scene.pricingId)).body.proposals.latest.id), 'utf8'));
      expect(latest).toMatchObject({ syntaxVersion: '3.1', version: '2.2.5', plans: { GOLD: { price: 7.5 }, PLATINUM: { price: 99 } } });
    });

    it('Merges into a newer private version privately by default, combining both (CA-39, CA-40).', async () => {
      const scene = await pricingWithPrivateLatest();
      const author = await outsider();
      const created = await openOn(author, scene, scene.v2, platinumAt(12));

      const preview = await mergePreviewOf(scene.owner.token, created.id);
      expect(preview).toMatchObject({ target: { id: scene.v3.id, private: true }, defaults: { private: true }, outcome: 'merged' });
      expect(preview.warnings).toContainEqual({ code: 'FORMAT_REGENERATED' });
      const response = await mergeAs(scene.owner.token, created.id, preview);

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.version).toMatchObject({ version: '9.0.0', private: true });
      const stored: any = await PricingMongoose.findById(response.body.version.id).lean();
      expect(stored.private).toBe(true);
      expect(docOf(readFileSync(requirePricingFile(String(stored.yaml)), 'utf8')).plans).toMatchObject({
        GOLD: { price: 987.65 }, PLATINUM: { price: 12 },
      });
    });

    it('Refuses a label the pricing already has, publishing nothing and leaving the pull request open (CA-41).', async () => {
      const scene = await publicScene();
      const author = await outsider();
      const created = await openOn(author, scene, scene.v2, goldAt(7.5));
      const preview = await mergePreviewOf(scene.owner.token, created.id);
      const files = await uploadedFiles([scene.organizationId]);
      const before = await versionCount(scene.pricingId);

      const taken = await mergeAs(scene.owner.token, created.id, preview, { version: '2.0.0' });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('VERSION_TAKEN');

      // The label is checked before the reservation: also while another merge holds it.
      const lock = await repository.reserveForMerge(created.id, 1, scene.owner.id);
      const whileHeld = await mergeAs(scene.owner.token, created.id, preview, { version: '1.0.0' });
      expect(whileHeld.body.code).toBe('VERSION_TAKEN');
      const held = await mergeAs(scene.owner.token, created.id, preview);
      expect(held.status).toBe(409);
      expect(held.body.code).toBe('PULL_REQUEST_MERGING');
      await repository.releaseMerge(created.id, lock!.id);

      // A label taken between the check and the publish is refused by the publish itself.
      const pricingRepository = appContainer.resolve('pricingRepository');
      const spy = vi.spyOn(pricingRepository, 'hasVersionLabel').mockResolvedValueOnce(false);
      try {
        const raced = await mergeAs(scene.owner.token, created.id, preview, { version: '2.0.0' });
        expect(raced.status).toBe(409);
        expect(raced.body.code).toBe('VERSION_TAKEN');
      } finally {
        spy.mockRestore();
      }

      expect(await versionCount(scene.pricingId)).toBe(before);
      const stored = await PricingPullRequestMongoose.findById(created.id).lean();
      expect(stored!.status).toBe('open');
      expect(stored!.mergeLock).toBeUndefined();
      expect(await uploadedFiles([scene.organizationId])).toEqual(files);
      expect((await mergeAs(scene.owner.token, created.id, preview)).status).toBe(200);
    });

    it('Leaves the other pull requests behind, or with nothing left to merge (CA-42).', async () => {
      const scene = await publicScene();
      const author = await outsider();
      const a = await openOn(author, scene, scene.v2, goldAt(7.5), 'A');
      const b = await openOn(author, scene, scene.v2, platinumAt(12), 'B');
      const c = await openOn(author, scene, scene.v2, goldAt(7.5), 'C');

      expect((await mergeAsShown(scene.owner.token, a.id)).response.status).toBe(200);

      const states = (await list(scene.owner.token, scene.pricingId)).body;
      expect(stateIn(states, a.id)).toEqual({ kind: 'merged' });
      expect(stateIn(states, b.id)).toEqual({ kind: 'behind', conflicts: 0 });
      expect(stateIn(states, c.id)).toEqual({ kind: 'no-changes' });
      const nothing = await mergePreviewOf(scene.owner.token, c.id);
      expect(nothing.outcome).toBe('no-changes');
      const refused = await mergeAs(scene.owner.token, c.id, nothing, { version: '9.9.9' });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('NO_CHANGES');
    });

    it('Lets every maintainer merge, refuses the author who is not one, and hides it from anyone else (CA-43, CA-82).', async () => {
      const scene = await pricingWithPrivateLatest();
      const admin = (await createAndLoginUser('USER')).user;
      await createMembership(admin.id, scene.organizationId, 'ADMIN');
      const creator = await memberOf(scene.organizationId, scene.slug, { GET: true, PUT: false, DELETE: false, CREATE: true });
      const globalAdmin = testContainer.resolve('adminUser');
      const author = await outsider();

      for (const [index, maintainer] of [scene.owner, admin, creator, globalAdmin].entries()) {
        const created = await openOn(author, scene, scene.v2, withFeature(`x-maintainer-${index}`));
        const preview = await mergePreviewOf(maintainer.token, created.id);
        const response = await mergeAs(maintainer.token, created.id, preview, { version: `9.${index}.0` });
        expect(response.status, `${maintainer.username}: ${JSON.stringify(response.body)}`).toBe(200);
        // They may read the private versions: the new ETag is theirs.
        expect(response.headers.etag).toMatch(PRICING_ETAG);
        expect(response.headers.etag).toBe(await etagOf(scene, scene.owner.token));
      }

      // Who may not publish versions, or not read the private ones: 403 for their own, 404 for another's.
      const editor = await memberOf(scene.organizationId, scene.slug, { GET: true, PUT: true, DELETE: false, CREATE: false });
      const reader = await memberOf(scene.organizationId, scene.slug, { GET: true, PUT: false, DELETE: false, CREATE: false });
      const blindCreator = await memberOf(scene.organizationId, scene.slug, { GET: false, PUT: false, DELETE: false, CREATE: true });
      const collectionEditor = (await createAndLoginUser('USER')).user;
      await createMembership(collectionEditor.id, scene.organizationId, 'MEMBER');
      const collection = await request(app())
        .post(`${BASE_PATH}/collections/${scene.organizationId}`)
        .set(bearer(scene.owner.token))
        .send({ name: `collection_${randomSuffix()}`, description: 'With P', private: false, pricings: [scene.slug] });
      expect(collection.status, JSON.stringify(collection.body)).toBe(201);
      const permission = await createEntityPermission(collectionEditor.id, scene.organizationId, 'collection', collection.body.slug, {
        GET: true, PUT: true, DELETE: false, CREATE: false,
      });
      permissionsToDelete.add(String(permission._id ?? permission.id));
      const others = await openOn(author, scene, scene.v2, goldAt(7.5));
      const before = await versionCount(scene.pricingId);
      for (const user of [editor, reader, collectionEditor]) {
        const own = await openOn(user, scene, scene.v2, goldAt(7.5));
        expect(own.permissions.merge).toBe(false);
        const refused = await mergeOf(user.token, own.id, { version: '9.9.0', private: false, previewToken: 'x.y' });
        expect(refused.status, user.username).toBe(403);
        expect(refused.body.code).toBe('FORBIDDEN');
        expect(leaks(refused, scene.markers)).toEqual([]);
        expect((await mergeOf(user.token, others.id, { version: '9.9.0', private: false, previewToken: 'x.y' })).status).toBe(404);
      }
      expect((await mergeOf(blindCreator.token, others.id, { version: '9.9.0', private: false, previewToken: 'x.y' })).status).toBe(404);
      expect((await mergeOf((await outsider()).token, others.id, { version: '9.9.0', private: false, previewToken: 'x.y' })).status).toBe(404);
      expect(await versionCount(scene.pricingId)).toBe(before);
    });

    it('Lets a member who may publish but not read private versions merge into a pricing without them, never giving them its ETag (CA-43).', async () => {
      const scene = await publicScene();
      const blindCreator = await memberOf(scene.organizationId, scene.slug, { GET: false, PUT: false, DELETE: false, CREATE: true });
      const author = await outsider();
      const first = await openOn(author, scene, scene.v2, goldAt(7.5));
      const second = await openOn(author, scene, scene.v2, platinumAt(12));
      const owners = await etagOf(scene, scene.owner.token);

      // A version published by someone else between the preview and the publish (simulated by moving the revision on).
      const preview = await mergePreviewOf(blindCreator.token, second.id);
      const pricingRepository = appContainer.resolve('pricingRepository');
      const hasVersionLabel = pricingRepository.hasVersionLabel.bind(pricingRepository);
      const spy = vi.spyOn(pricingRepository, 'hasVersionLabel').mockImplementationOnce(async (...args: any[]) => {
        await PricingIdentityMongoose.updateOne({ _id: scene.pricingId }, { $inc: { revision: 1 } });
        return hasVersionLabel(args[0], args[1]);
      });
      let changed;
      try {
        changed = await mergeAs(blindCreator.token, second.id, preview);
      } finally {
        spy.mockRestore();
      }
      expect(changed.status).toBe(409);
      expect(changed.body.code).toBe('PRICING_CHANGED_DURING_MERGE');
      expect(changed.headers.etag ?? '').not.toMatch(PRICING_ETAG);
      expect(await etagOf(scene, scene.owner.token)).not.toBe(owners);

      const merged = await mergeAsShown(blindCreator.token, first.id);
      expect(merged.response.status, JSON.stringify(merged.response.body)).toBe(200);
      expect(merged.response.headers.etag ?? '').not.toMatch(PRICING_ETAG);
      // Their own If-Match never matches: they were never given the tag.
      const refused = await mergeAs(blindCreator.token, second.id, await mergePreviewOf(blindCreator.token, second.id), {}, await etagOf(scene, scene.owner.token));
      expect(refused.status).toBe(412);
      expect(refused.headers.etag ?? '').not.toMatch(PRICING_ETAG);
    });

    it('Publishes one version when two pull requests are merged at once (CA-48).', async () => {
      const scene = await publicScene();
      const author = await outsider();
      const a = await openOn(author, scene, scene.v2, goldAt(7.5), 'A');
      const b = await openOn(author, scene, scene.v2, platinumAt(12), 'B');
      const previews = [await mergePreviewOf(scene.owner.token, a.id), await mergePreviewOf(scene.owner.token, b.id)];
      const before = await versionCount(scene.pricingId);

      const responses = await Promise.all([
        mergeAs(scene.owner.token, a.id, previews[0], { version: '3.0.0' }),
        mergeAs(scene.owner.token, b.id, previews[1], { version: '3.1.0' }),
      ]);

      expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
      const refused = responses.find(response => response.status === 409)!;
      expect(['PREVIEW_STALE', 'PRICING_CHANGED_DURING_MERGE']).toContain(refused.body.code);
      expect(await versionCount(scene.pricingId)).toBe(before + 1);
    });

    it('Refuses a preview older than a version published after it, public or private (CA-49).', async () => {
      const scene = await publicScene();
      const author = await outsider();
      const created = await openOn(author, scene, scene.v2, goldAt(7.5));

      for (const [index, isPrivate] of [false, true].entries()) {
        const preview = await mergePreviewOf(scene.owner.token, created.id);
        await publish(scene.owner.token, scene.organizationId, {
          name: scene.name, slug: scene.slug, version: `3.${index}.0`, isPrivate, change: both(V2, platinumAt(30 + index)),
        });
        const before = await versionCount(scene.pricingId);

        const response = await mergeAs(scene.owner.token, created.id, preview);

        expect(response.status).toBe(409);
        expect(response.body).toEqual({ error: 'There is a newer version than the one you reviewed', code: 'PREVIEW_STALE' });
        expect(await versionCount(scene.pricingId)).toBe(before);
      }
      // A stale preview wins over a stale If-Match.
      const preview = await mergePreviewOf(scene.owner.token, created.id);
      const stale = await etagOf(scene, scene.owner.token);
      await publish(scene.owner.token, scene.organizationId, { name: scene.name, slug: scene.slug, version: '3.5.0', change: V2 });
      expect((await mergeAs(scene.owner.token, created.id, preview, {}, stale)).body.code).toBe('PREVIEW_STALE');
    });

    it('Answers 412 to an If-Match older than a rename, whose preview still holds (CA-50).', async () => {
      const scene = await publicScene();
      const author = await outsider();
      const created = await openOn(author, scene, scene.v2, goldAt(7.5));
      const preview = await mergePreviewOf(scene.owner.token, created.id);
      const stale = await etagOf(scene, scene.owner.token);
      const renamed = `renamed_${randomSuffix()}`;
      const rename = await request(app()).put(pricingUrlOf(scene)).set(bearer(scene.owner.token)).send({ name: renamed });
      expect(rename.status, JSON.stringify(rename.body)).toBe(200);
      const moved = { ...scene, slug: (await PricingIdentityMongoose.findById(scene.pricingId).lean())!.slug };
      const current = await etagOf(moved, scene.owner.token);
      expect(current).not.toBe(stale);

      // 412 before a result that cannot be published.
      const refused = await mergeAs(scene.owner.token, created.id, preview, { manualYaml: 'saasName: [' }, stale);
      expect(refused.status).toBe(412);
      expect(refused.body.code).toBe('PRECONDITION_FAILED');
      expect(refused.headers.etag).toBe(current);

      const merged = await mergeAs(scene.owner.token, created.id, preview, {}, current);
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);
      expect(merged.headers.etag).not.toBe(current);
      expect(merged.headers.etag).toBe(await etagOf(moved, scene.owner.token));
      const stored: any = await PricingMongoose.findById(merged.body.version.id).lean();
      expect(stored.name).toBe(renamed);
      expect(docOf(readFileSync(requirePricingFile(String(stored.yaml)), 'utf8')).saasName).toBe(renamed);
    });

    it('Publishes one version when the same pull request is merged twice (CA-51).', async () => {
      const scene = await publicScene();
      const author = await outsider();
      const created = await openOn(author, scene, scene.v2, goldAt(7.5));
      const preview = await mergePreviewOf(scene.owner.token, created.id);
      const before = await versionCount(scene.pricingId);

      const responses = await Promise.all([1, 2].map(() => mergeAs(scene.owner.token, created.id, preview)));

      expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
      const refused = responses.find(response => response.status === 409)!;
      expect(['PULL_REQUEST_MERGING', 'PULL_REQUEST_NOT_OPEN', 'PREVIEW_STALE', 'PRICING_CHANGED_DURING_MERGE']).toContain(refused.body.code);
      expect(await versionCount(scene.pricingId)).toBe(before + 1);
      const again = await mergeAs(scene.owner.token, created.id, preview);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('PULL_REQUEST_NOT_OPEN');
    });

    it('Merges a pull request whose fork or author is gone (CA-70).', async () => {
      const scene = await forkScene();
      const fromFork = await proposeFromScene(scene);
      expect(fromFork.status).toBe(201);
      const gone = await outsider();
      const byGone = await openOn(gone, scene, scene.v2, platinumAt(12));
      expect((await request(app()).delete(`${BASE_PATH}/pricings/${scene.forkOrganizationId}/${scene.fork.slug}`).set(bearer(scene.forker.token))).status).toBe(200);

      const withoutFork = await mergeAsShown(scene.owner.token, fromFork.body.id);
      expect(withoutFork.response.status, JSON.stringify(withoutFork.response.body)).toBe(200);
      expect(withoutFork.response.body.pullRequest.origin).toBeUndefined();

      await deleteTestUser(gone.username);
      const withoutAuthor = await mergeAsShown(scene.owner.token, byGone.id, { version: '7.0.0' });
      expect(withoutAuthor.response.status, JSON.stringify(withoutAuthor.response.body)).toBe(200);
      expect(withoutAuthor.response.body.pullRequest.author).toBeNull();
    });

    it('Marks merged a pull request whose merge published its version but stopped before saying so (CA-92).', async () => {
      const scene = await publicScene();
      const author = await outsider();
      const created = await openOn(author, scene, scene.v2, goldAt(7.5));
      const lock = await repository.reserveForMerge(created.id, 1, scene.owner.id);
      // The version the interrupted merge published.
      const published = await publish(scene.owner.token, scene.organizationId, {
        name: scene.name, slug: scene.slug, version: '9.0.0', change: both(V2, goldAt(7.5)),
      });
      await PricingMongoose.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(published.id) },
        { $set: { mergedFrom: { number: created.number, prId: new mongoose.Types.ObjectId(created.id) } } }
      );

      const shown = await detail(author.token, created.id);

      expect(shown.body).toMatchObject({ status: 'merged', merged: { versionId: published.id, version: '9.0.0' } });
      const stored = await PricingPullRequestMongoose.findById(created.id).lean();
      expect(stored!.mergeLock).toBeUndefined();
      expect(lock).not.toBeNull();
      expect(stored!.merged).toMatchObject({ proposalRevision: 1, version: '9.0.0' });
      expect(String(stored!.merged!.byId)).toBe(scene.owner.id);
      expect(String(stored!.merged!.versionId)).toBe(published.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------

  describe('Notifications', { timeout: 30000 }, () => {
    it('Tells the maintainers who are members, by inbox and email as each one chose, and never the author (CA-56).', async () => {
      const scene = await publicScene();
      const admin = (await createAndLoginUser('USER')).user;
      await createMembership(admin.id, scene.organizationId, 'ADMIN');
      const muted = (await createAndLoginUser('USER')).user;
      await createMembership(muted.id, scene.organizationId, 'ADMIN');
      const preferences = await request(app())
        .put(`${BASE_PATH}/users/me/settings/notifications`)
        .set(bearer(muted.token))
        .send({ PricingPullRequest: { email: false, inbox: false } });
      expect(preferences.status).toBe(200);
      const reader = await memberOf(scene.organizationId, scene.slug, { GET: true, PUT: false, DELETE: false, CREATE: false });
      const globalAdmin = testContainer.resolve('adminUser');
      const author = await outsider();
      const emails = vi.spyOn(appContainer.resolve('emailService'), 'sendNotificationEmail');

      let created: any;
      let recipients: string[];
      try {
        created = await openOn(author, scene, scene.v2, goldAt(7.5));
        await eventually(async () => {
          expect(await pullRequestNotices(scene.owner.token, created.id)).toHaveLength(1);
          expect(await pullRequestNotices(admin.token, created.id)).toHaveLength(1);
        });
        await settle();
        recipients = emails.mock.calls.map(([email]: any[]) => email.recipientEmail);
      } finally {
        emails.mockRestore();
      }

      const [notice] = await pullRequestNotices(scene.owner.token, created.id);
      expect(notice).toMatchObject({
        title: `New pull request #${created.number} on ${scene.name}`,
        message: expect.stringContaining(created.title),
        data: { pricingId: scene.pricingId, pullRequestId: created.id, number: created.number, organizationId: scene.organizationId, pricingSlug: scene.slug },
      });
      expect(notice.title).not.toContain(created.title);
      for (const user of [muted, reader, globalAdmin, author]) {
        expect(await pullRequestNotices(user.token, created.id), user.username).toEqual([]);
      }
      expect(recipients).toContain(scene.owner.email);
      expect(recipients).toContain(admin.email);
      expect(recipients).not.toContain(muted.email);
      expect(recipients).not.toContain(author.email);
    });

    it('Tells the author when someone else merges or rejects their pull request, naming the version only if they may read it (CA-57, CA-46).', async () => {
      const scene = await pricingWithPrivateLatest();
      const author = await outsider();
      const merged = await openOn(author, scene, scene.v2, platinumAt(12));
      const rejected = await openOn(author, scene, scene.v2, goldAt(7.5));
      const withdrawn = await openOn(author, scene, scene.v2, platinumAt(13));
      const own = await openOn(scene.owner, scene, scene.v2, withFeature('x-own'));
      const secret = `9.0.0-secret-${randomSuffix()}`;

      const preview = await mergePreviewOf(scene.owner.token, merged.id);
      expect((await mergeAs(scene.owner.token, merged.id, preview, { version: secret, private: true })).status).toBe(200);
      expect((await close(scene.owner.token, rejected.id, { reason: 'Not now' })).status).toBe(200);
      const withdrawal = await close(author.token, withdrawn.id);
      expect(withdrawal.status, JSON.stringify(withdrawal.body)).toBe(200);
      const ownPreview = await mergePreviewOf(scene.owner.token, own.id);
      expect((await mergeAs(scene.owner.token, own.id, ownPreview, { version: '9.1.0' })).status).toBe(200);

      await eventually(async () => {
        expect(await pullRequestNotices(author.token, merged.id)).toHaveLength(1);
        expect(await pullRequestNotices(author.token, rejected.id)).toHaveLength(1);
      });
      await settle();
      const [mergedNotice] = await pullRequestNotices(author.token, merged.id);
      expect(mergedNotice.title).toBe(`Pull request #${merged.number} on ${scene.name} was merged`);
      expect(leaks({ body: mergedNotice, headers: {} }, [...scene.markers, secret])).toEqual([]);
      expect(Object.keys(mergedNotice.data).sort()).toEqual(['number', 'organizationId', 'pricingId', 'pricingSlug', 'pullRequestId']);
      const [rejectedNotice] = await pullRequestNotices(author.token, rejected.id);
      expect(rejectedNotice).toMatchObject({ title: `Pull request #${rejected.number} on ${scene.name} was closed`, message: expect.stringContaining('Not now') });
      expect(await pullRequestNotices(author.token, withdrawn.id)).toEqual([]);
      expect(await pullRequestNotices(scene.owner.token, own.id)).toEqual([]);
      // Who may read the private version is told which one it became.
      const reader = await memberOf(scene.organizationId, scene.slug, { GET: true, PUT: false, DELETE: false, CREATE: false });
      const readers = await openOn(reader, scene, scene.v2, withFeature('x-reader'));
      const readerPreview = await mergePreviewOf(scene.owner.token, readers.id);
      expect((await mergeAs(scene.owner.token, readers.id, readerPreview, { version: secret + '-2', private: true })).status).toBe(200);
      await eventually(async () => expect(await pullRequestNotices(reader.token, readers.id)).toHaveLength(1));
      expect((await pullRequestNotices(reader.token, readers.id))[0].message).toContain(`${secret}-2`);
    });

    it('Tells the followers of the pricing about the merged version (CA-58).', async () => {
      const scene = await publicScene();
      const follower = await outsider();
      expect((await request(app()).put(`${BASE_PATH}/pricing-follows/${scene.organizationId}/${scene.slug}`).set(bearer(follower.token))).status).toBe(200);
      const author = await outsider();
      const created = await openOn(author, scene, scene.v2, goldAt(7.5));

      expect((await mergeAsShown(scene.owner.token, created.id)).response.status).toBe(200);

      await eventually(async () => {
        const response = await request(app()).get(`${BASE_PATH}/notifications`).set(bearer(follower.token));
        const updates = (response.body as any[]).filter(notice => notice.kind === 'PricingUpdated');
        expect(updates).toHaveLength(1);
        expect(updates[0].data).toMatchObject({ pricingSlug: scene.slug, version: '9.0.0' });
      });
    });

    it('Tells the maintainers about new proposals from the fork at most once a day (CA-104).', async () => {
      const scene = await forkScene();
      const first = await proposeFromScene(scene);
      expect(first.status).toBe(201);
      await eventually(async () => expect(await pullRequestNotices(scene.owner.token, first.body.id)).toHaveLength(1));

      for (let round = 0; round < 3; round++) expect((await proposeFromScene(scene)).status).toBe(200);
      await settle();
      expect(await pullRequestNotices(scene.owner.token, first.body.id)).toHaveLength(1);

      await PricingPullRequestMongoose.updateOne({ _id: first.body.id }, { $set: { lastNotifiedAt: new Date(Date.now() - 25 * HOUR) } });
      expect((await proposeFromScene(scene)).status).toBe(200);
      await eventually(async () => {
        const notices = await pullRequestNotices(scene.owner.token, first.body.id);
        expect(notices).toHaveLength(2);
        expect(notices.map(notice => notice.title)).toContain(`Pull request #${first.body.number} on ${scene.name} was updated`);
      });
    });
  });
});
