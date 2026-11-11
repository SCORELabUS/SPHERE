import dotenv from 'dotenv';
import { promises as fsp, readFileSync } from 'fs';
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
import { createMembership } from './utils/organizations';
import { createEntityPermission } from './utils/permissions/permissionTestUtils';
import { forkPricingIntoOrganization } from './utils/pricings/pricingTestUtils';
import { getMongoDBConnectionURI } from '../main/config/mongoose';
import { seedDatabase } from '../main/database/seeders/mongo/seeder';
import { up } from '../main/migrations/mongo/20261111120000-create-pricing-pull-requests';
import EntityPermissionMongoose from '../main/repositories/mongoose/models/EntityPermissionMongoose';
import OrganizationMembershipMongoose from '../main/repositories/mongoose/models/OrganizationMembershipMongoose';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import PricingIdentityMongoose from '../main/repositories/mongoose/models/PricingIdentityMongoose';
import PricingPullRequestMongoose from '../main/repositories/mongoose/models/PricingPullRequestMongoose';
import PricingPullRequestRepository, {
  MERGE_LOCK_MS,
  duplicateKeyFields,
} from '../main/repositories/mongoose/PricingPullRequestRepository';
import { NewPricingPullRequest } from '../main/types/models/PricingPullRequest';
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
      // Its proposal ends up as the base: compared with itself it is up to date, not "no changes".
      expect((await edit(external.token, sameAsBase.id, { proposedYaml: pricingYaml(scene.name, '9.0.0', V2) })).status).toBe(200);
      expect((await detail(external.token, sameAsBase.id)).body.state).toEqual({ kind: 'up-to-date' });

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

      // Brought up to date (the route that does it comes with the previews), its proposal can change again.
      await repository.updateOpen(behind.id, 1, {
        base: { versionId: v4.id, version: v4.version, yaml: v4.text },
        proposed: { yaml: pricingYaml(scene.name, '9.0.0', both(V2, goldAt(7.5), platinumAt(20))), suggestedVersion: '9.0.0' },
      });
      const afterUpdate = await edit(external.token, behind.id, { proposedYaml: pricingYaml(scene.name, '9.0.0', both(V2, goldAt(7), platinumAt(20))) });
      expect(afterUpdate.status).toBe(200);
      expect(afterUpdate.body).toMatchObject({ proposalRevision: 3, state: { kind: 'up-to-date' } });
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
      const body = { title: 'Again', source: textSource(scene.pricingId, scene.v2.id, pricingYaml(scene.name, '9.0.0', both(V2, goldAt(6)))) };
      const routes = [
        (call: any) => call.get(`${PULL_REQUESTS}?pricingId=${scene.pricingId}`),
        (call: any) => call.post(PULL_REQUESTS).send(body),
        (call: any) => call.get(`${PULL_REQUESTS}/${created.id}`),
        (call: any) => call.put(`${PULL_REQUESTS}/${created.id}`).send({ title: 'Changed' }),
        (call: any) => call.post(`${PULL_REQUESTS}/${created.id}/close`).send({}),
      ];

      for (const route of routes) {
        const withKey = await route(request(app())).set('x-api-key', keyResponse.body.plainKey);
        expect(withKey.status).toBe(401);
        expect(withKey.body).toEqual({ error: 'A SPHERE web session is required', code: 'WEB_SESSION_REQUIRED' });

        const others = [
          route(request(app())).set('Authorization', `Bearer sph_oat_${randomSuffix()}`),
          route(request(app())).set('Cookie', `token=${author.token}`),
          route(request(app())),
        ];
        for (const response of await Promise.all(others)) expect(response.status).toBe(401);
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
});
