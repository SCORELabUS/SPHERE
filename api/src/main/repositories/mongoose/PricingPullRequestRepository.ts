import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import RepositoryBase from '../RepositoryBase';
import PricingPullRequestMongoose from './models/PricingPullRequestMongoose';
import {
  NewPricingPullRequest,
  PULL_REQUEST_STATUSES,
  PricingPullRequest,
  PullRequestChanges,
  PullRequestClosed,
  PullRequestListFilter,
  PullRequestMergeLock,
  PullRequestMerged,
  PullRequestPage,
  PullRequestStatus,
} from '../../types/models/PricingPullRequest';

/** How long a merge keeps its reservation of the pull request. */
export const MERGE_LOCK_MS = 10 * 60 * 1000;

/** How many times `create` takes the next number again after another request took it first. */
const NUMBER_RETRIES = 3;

const objectId = (id: string) => new mongoose.Types.ObjectId(id);

/**
 * The fields of the unique index a duplicate key error (E11000) broke, e.g.
 * `['pricingId', 'number']`, or null for any other error.
 */
export function duplicateKeyFields(err: unknown): string[] | null {
  const error = err as { code?: number; keyPattern?: Record<string, unknown> } | null;
  if (error?.code !== 11000 || !error.keyPattern) return null;
  return Object.keys(error.keyPattern);
}

const sameFields = (fields: string[] | null, expected: string[]) =>
  fields !== null && fields.length === expected.length && fields.every((field, index) => field === expected[index]);

/** No reservation, or one that lapsed before `now`. */
const noActiveLock = (now: Date) => ({
  $or: [{ mergeLock: { $exists: false } }, { 'mergeLock.until': { $lt: now } }],
});

function toPricingPullRequest(doc: any): PricingPullRequest {
  return {
    id: String(doc._id),
    pricingId: String(doc.pricingId),
    number: doc.number,
    title: doc.title,
    description: doc.description ?? '',
    authorId: String(doc.authorId),
    status: doc.status,
    base: { versionId: String(doc.base.versionId), version: doc.base.version, yaml: doc.base.yaml },
    proposed: { yaml: doc.proposed.yaml, suggestedVersion: doc.proposed.suggestedVersion },
    proposalRevision: doc.proposalRevision,
    ...(doc.origin ? {
      origin: {
        pricingId: String(doc.origin.pricingId),
        versionId: String(doc.origin.versionId),
        version: doc.origin.version,
        baseVersionId: String(doc.origin.baseVersionId),
        edited: Boolean(doc.origin.edited),
      },
    } : {}),
    ...(doc.mergeLock ? {
      mergeLock: {
        id: doc.mergeLock.id,
        byId: String(doc.mergeLock.byId),
        until: doc.mergeLock.until,
        revision: doc.mergeLock.revision,
      },
    } : {}),
    ...(doc.merged ? {
      merged: {
        byId: String(doc.merged.byId),
        at: doc.merged.at,
        versionId: String(doc.merged.versionId),
        version: doc.merged.version,
        proposalRevision: doc.merged.proposalRevision,
      },
    } : {}),
    ...(doc.closed ? {
      closed: {
        byId: String(doc.closed.byId),
        at: doc.closed.at,
        kind: doc.closed.kind,
        ...(doc.closed.reason !== undefined ? { reason: doc.closed.reason } : {}),
      },
    } : {}),
    ...(doc.lastNotifiedAt ? { lastNotifiedAt: doc.lastNotifiedAt } : {}),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

const baseOf = (base: PricingPullRequest['base']) => ({ ...base, versionId: objectId(base.versionId) });

const originOf = (origin: NonNullable<PricingPullRequest['origin']>) => ({
  ...origin,
  pricingId: objectId(origin.pricingId),
  versionId: objectId(origin.versionId),
  baseVersionId: objectId(origin.baseVersionId),
});

class PricingPullRequestRepository extends RepositoryBase {
  /**
   * Creates an open pull request with the next number of its pricing (the
   * highest plus one). When another request takes that number first, the
   * unique index on (pricingId, number) refuses it and the number is taken again;
   * any other duplicate key error, such as a second open pull request from the
   * same fork, is thrown for the caller to tell apart with `duplicateKeyFields`.
   */
  async create(data: NewPricingPullRequest): Promise<PricingPullRequest> {
    const pricingId = objectId(data.pricingId);
    for (let attempt = 0; ; attempt++) {
      const last = await PricingPullRequestMongoose.findOne({ pricingId }).sort({ number: -1 }).select('number').lean();
      try {
        const doc = await PricingPullRequestMongoose.create({
          pricingId,
          number: (last?.number ?? 0) + 1,
          title: data.title,
          description: data.description,
          authorId: objectId(data.authorId),
          status: 'open',
          base: baseOf(data.base),
          proposed: data.proposed,
          proposalRevision: 1,
          ...(data.origin ? { origin: originOf(data.origin) } : {}),
        });
        return toPricingPullRequest(doc.toObject());
      } catch (err) {
        if (attempt < NUMBER_RETRIES && sameFields(duplicateKeyFields(err), ['pricingId', 'number'])) continue;
        throw err;
      }
    }
  }

  async findById(id: string): Promise<PricingPullRequest | null> {
    if (!this.isValidObjectId(id)) return null;
    const doc = await PricingPullRequestMongoose.findById(id).lean();
    return doc ? toPricingPullRequest(doc) : null;
  }

  /** A page of the pricing's pull requests, the most recently updated first. */
  async list(filter: PullRequestListFilter, page: number, pageSize: number): Promise<PullRequestPage> {
    const scope: Record<string, unknown> = { pricingId: objectId(filter.pricingId) };
    if (filter.authorId) scope.authorId = objectId(filter.authorId);
    const query = filter.status ? { ...scope, status: filter.status } : scope;
    const [docs, total, grouped] = await Promise.all([
      PricingPullRequestMongoose.find(query)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(Math.max(0, page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      PricingPullRequestMongoose.countDocuments(query),
      PricingPullRequestMongoose.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    const counts = Object.fromEntries(PULL_REQUEST_STATUSES.map(status => [status, 0])) as Record<PullRequestStatus, number>;
    for (const group of grouped) counts[group._id as PullRequestStatus] = group.count;
    return { items: docs.map(toPricingPullRequest), total, counts };
  }

  /** Open pull requests of a pricing, or only those of one author. */
  async countOpen(pricingId: string, authorId?: string): Promise<number> {
    return PricingPullRequestMongoose.countDocuments({
      pricingId: objectId(pricingId),
      status: 'open',
      ...(authorId ? { authorId: objectId(authorId) } : {}),
    });
  }

  /** Pull requests an author created, on any pricing, from `since` on. */
  async countCreatedSince(authorId: string, since: Date): Promise<number> {
    return PricingPullRequestMongoose.countDocuments({ authorId: objectId(authorId), createdAt: { $gte: since } });
  }

  /** The open pull request from the fork `forkPricingId` to `pricingId`, if any. */
  async findOpenFromFork(pricingId: string, forkPricingId: string): Promise<PricingPullRequest | null> {
    const doc = await PricingPullRequestMongoose.findOne({
      pricingId: objectId(pricingId),
      'origin.pricingId': objectId(forkPricingId),
      status: 'open',
    }).lean();
    return doc ? toPricingPullRequest(doc) : null;
  }

  /** The merged pull requests from the fork `forkPricingId` to `pricingId`, the most recently merged first. */
  async findMergedFromFork(pricingId: string, forkPricingId: string): Promise<PricingPullRequest[]> {
    const docs = await PricingPullRequestMongoose.find({
      pricingId: objectId(pricingId),
      'origin.pricingId': objectId(forkPricingId),
      status: 'merged',
    })
      .sort({ 'merged.at': -1, _id: -1 })
      .lean();
    return docs.map(toPricingPullRequest);
  }

  /**
   * Applies `changes` only if the pull request is open, its proposal is still at
   * `expectedRevision` and no merge holds a live reservation. A new proposal
   * moves the revision on. Returns null when any of that does not hold.
   */
  async updateOpen(id: string, expectedRevision: number, changes: PullRequestChanges, now = new Date()): Promise<PricingPullRequest | null> {
    if (!this.isValidObjectId(id)) return null;
    const set: Record<string, unknown> = {};
    if (changes.title !== undefined) set.title = changes.title;
    if (changes.description !== undefined) set.description = changes.description;
    if (changes.base) set.base = baseOf(changes.base);
    if (changes.proposed) set.proposed = changes.proposed;
    if (changes.origin) {
      set.origin = originOf({ ...changes.origin, edited: changes.originEdited ?? changes.origin.edited });
    } else if (changes.originEdited !== undefined) {
      set['origin.edited'] = changes.originEdited;
    }
    const doc = await PricingPullRequestMongoose.findOneAndUpdate(
      { _id: objectId(id), status: 'open', proposalRevision: expectedRevision, ...noActiveLock(now) },
      {
        ...(Object.keys(set).length ? { $set: set } : {}),
        // A lapsed reservation goes with the change.
        $unset: { mergeLock: '' },
        ...(changes.proposed ? { $inc: { proposalRevision: 1 } } : {}),
      },
      { new: true }
    ).lean();
    return doc ? toPricingPullRequest(doc) : null;
  }

  /**
   * Reserves the pull request for a merge of its proposal at `revision`, if it is
   * open, still at that revision and no other merge holds a live reservation.
   */
  async reserveForMerge(id: string, revision: number, byId: string, now = new Date()): Promise<PullRequestMergeLock | null> {
    if (!this.isValidObjectId(id)) return null;
    const lock = { id: randomUUID(), byId, until: new Date(now.getTime() + MERGE_LOCK_MS), revision };
    const doc = await PricingPullRequestMongoose.findOneAndUpdate(
      { _id: objectId(id), status: 'open', proposalRevision: revision, ...noActiveLock(now) },
      { $set: { mergeLock: { ...lock, byId: objectId(byId) } } },
      { new: true, timestamps: false }
    ).lean();
    return doc ? lock : null;
  }

  /**
   * Gives the reservation `lockId` back, if it is still the one held. Taking and
   * giving back a reservation leaves `updatedAt` alone, like `touchNotified`.
   */
  async releaseMerge(id: string, lockId: string): Promise<boolean> {
    if (!this.isValidObjectId(id)) return false;
    const result = await PricingPullRequestMongoose.updateOne(
      { _id: objectId(id), 'mergeLock.id': lockId },
      { $unset: { mergeLock: '' } },
      { timestamps: false }
    );
    return result.modifiedCount === 1;
  }

  /** Marks the pull request merged, only by the merge holding the reservation `lockId`. */
  async markMerged(id: string, lockId: string, merged: PullRequestMerged): Promise<PricingPullRequest | null> {
    if (!this.isValidObjectId(id)) return null;
    const doc = await PricingPullRequestMongoose.findOneAndUpdate(
      { _id: objectId(id), status: 'open', 'mergeLock.id': lockId },
      {
        $set: {
          status: 'merged',
          merged: { ...merged, byId: objectId(merged.byId), versionId: objectId(merged.versionId) },
        },
        $unset: { mergeLock: '' },
      },
      { new: true }
    ).lean();
    return doc ? toPricingPullRequest(doc) : null;
  }

  /** Closes the pull request if it is open and no merge holds a live reservation. */
  async close(id: string, closed: PullRequestClosed, now = new Date()): Promise<PricingPullRequest | null> {
    if (!this.isValidObjectId(id)) return null;
    const doc = await PricingPullRequestMongoose.findOneAndUpdate(
      { _id: objectId(id), status: 'open', ...noActiveLock(now) },
      {
        $set: { status: 'closed', closed: { ...closed, byId: objectId(closed.byId) } },
        $unset: { mergeLock: '' },
      },
      { new: true }
    ).lean();
    return doc ? toPricingPullRequest(doc) : null;
  }

  /**
   * Records a round of notifications at `now`, only if there was none after
   * `since`. Of two callers at once, one gets true.
   */
  async touchNotified(id: string, since: Date, now = new Date()): Promise<boolean> {
    if (!this.isValidObjectId(id)) return false;
    const result = await PricingPullRequestMongoose.updateOne(
      { _id: objectId(id), $or: [{ lastNotifiedAt: { $exists: false } }, { lastNotifiedAt: { $lte: since } }] },
      { $set: { lastNotifiedAt: now } },
      { timestamps: false }
    );
    return result.modifiedCount === 1;
  }
}

export default PricingPullRequestRepository;
