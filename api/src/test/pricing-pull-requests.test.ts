import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { shutdownApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { randomSuffix } from './utils/helpers';
import { getMongoDBConnectionURI } from '../main/config/mongoose';
import { seedDatabase } from '../main/database/seeders/mongo/seeder';
import { up } from '../main/migrations/mongo/20261111120000-create-pricing-pull-requests';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import PricingIdentityMongoose from '../main/repositories/mongoose/models/PricingIdentityMongoose';
import PricingPullRequestMongoose from '../main/repositories/mongoose/models/PricingPullRequestMongoose';
import PricingPullRequestRepository, {
  MERGE_LOCK_MS,
  duplicateKeyFields,
} from '../main/repositories/mongoose/PricingPullRequestRepository';
import { NewPricingPullRequest } from '../main/types/models/PricingPullRequest';

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

dotenv.config();

const COLLECTION = 'pricingPullRequests';
const HOUR = 60 * 60 * 1000;
const newId = () => new mongoose.Types.ObjectId().toString();

describe('Pricing pull requests', () => {
  const repository: PricingPullRequestRepository = new PricingPullRequestRepository();
  const pricingIds = new Set<string>();

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
});
