import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../main/config/container', () => ({
  // Only `createVersion` resolves something here: the followers to tell.
  default: { resolve: vi.fn(() => ({ notifyNewVersion: async () => undefined })) },
}));
vi.mock('pricing4ts/server', async importOriginal => {
  const actual = await importOriginal<typeof import('pricing4ts/server')>();
  // The analytics run MiniZinc; what they say does not matter here.
  return {
    ...actual,
    PricingService: class {
      async getAnalytics() {
        return {};
      }
    },
  };
});

import PricingPullRequestService from '../../main/services/PricingPullRequestService';
import PricingService from '../../main/services/PricingService';
import { PricingPullRequest, PullRequestError } from '../../main/types/models/PricingPullRequest';
import { LeanUser } from '../../main/types/models/User';
import { PricingPrecondition } from '../../main/utils/pricing-etag';
import { requirePricingFile } from '../../main/utils/pricing-files';
import { dumpPricingDoc, loadPricingDoc, STORED_PRICING_MAX_BYTES, upgradeToLatestSyntax } from '../../main/utils/pricing-syntax';

const objectId = () => new mongoose.Types.ObjectId().toString();
const UPLOADED = path.resolve(process.cwd(), 'public', 'static', 'pricings', 'uploaded');
const MERGE_LOCK_MS = 10 * 60 * 1000;
const SLUG = 'petclinic-race';
const NAME = 'Petclinic race';

const TEMPLATE = upgradeToLatestSyntax(
  loadPricingDoc(
    fs.readFileSync(path.resolve(process.cwd(), 'public', 'static', 'pricings', 'templates', 'petclinic.yml'), 'utf8'),
    STORED_PRICING_MAX_BYTES
  )
).doc;

type Change = (doc: any) => void;

function pricingText(name: string, version: string, change?: Change) {
  const doc: any = structuredClone(TEMPLATE);
  doc.saasName = name;
  doc.version = version;
  doc.createdAt = '2024-01-01';
  change?.(doc);
  return dumpPricingDoc(doc);
}

const goldAt = (price: number): Change => doc => {
  doc.plans.GOLD.price = price;
};
const platinumAt = (price: number): Change => doc => {
  doc.plans.PLATINUM.price = price;
};

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

const user = (id: string) => ({ id, username: id, role: 'USER' }) as unknown as LeanUser;
const OWNER = user('owner');
const AUTHOR = user('author');

interface VersionRow {
  _id: string;
  pricingId: string;
  version: string;
  private: boolean;
  yaml: string;
  forkedFrom?: string;
  mergedFrom?: { number: number; prId: string };
}

type Hook = 'findLatestVersion' | 'findRevision' | 'hasVersionLabel' | 'create' | 'markMerged' | 'createPullRequest';

const organizations: string[] = [];

/**
 * The real PricingPullRequestService and PricingService (`createVersion` →
 * `_createPricingVersion` → `_withRevisionClaim`/`_claimRevision`/`_setEtag`),
 * with their stores in memory: versions and revisions with the semantics of
 * `PricingRepository.claimRevision` (a tag names its pricing by a string id), and
 * pull requests with the conditions of `updateOpen`, `reserveForMerge`,
 * `markMerged` and `close`. `hooks` run inside the stores, to pause or fail them.
 */
function fixture(options: { blind?: string[] } = {}) {
  const organizationId = objectId();
  const forkOrganizationId = objectId();
  organizations.push(organizationId, forkOrganizationId);
  const pricingId = objectId();
  const forkId = objectId();
  const identities = new Map([
    [pricingId, { pricingId, name: NAME, slug: SLUG, organizationId, collectionId: null }],
    [forkId, { pricingId: forkId, name: 'Fork', slug: 'fork-race', organizationId: forkOrganizationId, collectionId: null }],
  ]);
  const revisions = new Map([[pricingId, 0], [forkId, 0]]);
  const versions: VersionRow[] = [];
  const hooks: Partial<Record<Hook, () => Promise<void>>> = {};
  const run = async (hook: Hook) => hooks[hook]?.();
  const bump = (id: string) => revisions.set(id, (revisions.get(id) ?? 0) + 1);

  function addVersion(id: string, version: string, text: string, extra: Partial<VersionRow> = {}) {
    const relative = `static/pricings/uploaded/${identities.get(id)!.organizationId}/seed-${version}-${randomUUID()}.yml`;
    fs.mkdirSync(path.dirname(requirePricingFile(relative)), { recursive: true });
    fs.writeFileSync(requirePricingFile(relative), text, 'utf8');
    const row: VersionRow = { _id: objectId(), pricingId: id, version, private: false, yaml: relative, ...extra };
    versions.push(row);
    bump(id);
    return row;
  }

  const newestFirst = (id: string) => versions.filter(row => row.pricingId === id).reverse();
  const stored = (row: VersionRow) => ({ id: row._id, version: row.version, private: row.private, yaml: row.yaml });

  const pricingRepository = {
    findIdentity: async (id: string) => identities.get(id) ?? null,
    findLocation: async (id: string) => {
      const identity = identities.get(id);
      return identity ? { slug: identity.slug, organizationId: identity.organizationId } : null;
    },
    findLatestVersion: async (id: string, { publicOnly = false } = {}) => {
      await run('findLatestVersion');
      const row = newestFirst(id).find(candidate => !publicOnly || !candidate.private);
      return row ? stored(row) : null;
    },
    findVersionOf: async (id: string, versionId: string) => {
      const row = versions.find(candidate => candidate.pricingId === id && candidate._id === versionId);
      return row ? stored(row) : null;
    },
    findForkVersions: async (id: string) =>
      newestFirst(id).map(row => ({ ...stored(row), forkedFromPricingId: row.forkedFrom ?? null })),
    hasPrivateVersion: async (id: string) => versions.some(row => row.pricingId === id && row.private),
    hasVersionLabel: async (id: string, label: string) => {
      await run('hasVersionLabel');
      return versions.some(row => row.pricingId === id && row.version === label);
    },
    findRevision: async (id: string) => {
      await run('findRevision');
      return revisions.get(id) ?? null;
    },
    claimRevision: vi.fn(async (id: string, precondition: PricingPrecondition) => {
      if (precondition.kind === 'any') return identities.has(id);
      const matching = precondition.tags.filter(tag => tag.pricingId === id).map(tag => tag.revision);
      if (!matching.includes(revisions.get(id)!)) return false;
      bump(id);
      return true;
    }),
    findOne: async (slug: string, organization: string) => {
      const identity = [...identities.values()].find(candidate => candidate.slug === slug && candidate.organizationId === organization);
      if (!identity) return null;
      return {
        pricingId: identity.pricingId,
        name: identity.name,
        slug: identity.slug,
        private: false,
        collection: null,
        versions: newestFirst(identity.pricingId).map(row => ({ version: row.version, private: row.private })),
      };
    },
    create: vi.fn(async ([data]: any[]) => {
      await run('create');
      const id = String(data.pricingId);
      if (versions.some(row => row.pricingId === id && row.version === data.version)) {
        throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
      }
      const row: VersionRow = {
        _id: objectId(), pricingId: id, version: data.version, private: data.private, yaml: data.yaml,
        ...(data.mergedFrom ? { mergedFrom: { number: data.mergedFrom.number, prId: String(data.mergedFrom.prId) } } : {}),
      };
      versions.push(row);
      bump(id);
      return [{ ...data, _id: row._id }];
    }),
    updateAnalytics: async () => undefined,
    findMergedVersion: async (id: string, prId: string) => {
      const row = versions.find(candidate => candidate.pricingId === id && candidate.mergedFrom?.prId === prId);
      return row ? stored(row) : null;
    },
  };

  const pullRequests = new Map<string, PricingPullRequest>();
  const copy = (pullRequest: PricingPullRequest) => structuredClone(pullRequest);
  const lockIsLive = (pullRequest: PricingPullRequest, now: Date) =>
    Boolean(pullRequest.mergeLock && pullRequest.mergeLock.until.getTime() > now.getTime());
  const pullRequestRepository = {
    create: vi.fn(async (data: any) => {
      await run('createPullRequest');
      const now = new Date();
      const created: PricingPullRequest = {
        ...structuredClone(data), id: objectId(), number: pullRequests.size + 1, status: 'open', proposalRevision: 1, createdAt: now, updatedAt: now,
      };
      pullRequests.set(created.id, created);
      return copy(created);
    }),
    findById: async (id: string) => (pullRequests.has(id) ? copy(pullRequests.get(id)!) : null),
    findOpenFromFork: async (id: string, fork: string) => {
      const open = [...pullRequests.values()].find(candidate =>
        candidate.pricingId === id && candidate.origin?.pricingId === fork && candidate.status === 'open');
      return open ? copy(open) : null;
    },
    findMergedFromFork: async () => [],
    countOpen: async () => 0,
    countCreatedSince: async () => 0,
    updateOpen: async (id: string, expectedRevision: number, changes: any, now = new Date()) => {
      const pullRequest = pullRequests.get(id);
      if (!pullRequest || pullRequest.status !== 'open' || pullRequest.proposalRevision !== expectedRevision || lockIsLive(pullRequest, now)) {
        return null;
      }
      const { originEdited, ...rest } = changes;
      Object.assign(pullRequest, structuredClone(rest));
      if (originEdited !== undefined && pullRequest.origin) pullRequest.origin.edited = originEdited;
      delete pullRequest.mergeLock;
      if (changes.proposed) pullRequest.proposalRevision += 1;
      return copy(pullRequest);
    },
    reserveForMerge: async (id: string, revision: number, byId: string, now = new Date()) => {
      const pullRequest = pullRequests.get(id);
      if (!pullRequest || pullRequest.status !== 'open' || pullRequest.proposalRevision !== revision || lockIsLive(pullRequest, now)) {
        return null;
      }
      pullRequest.mergeLock = { id: randomUUID(), byId, until: new Date(now.getTime() + MERGE_LOCK_MS), revision };
      return { ...pullRequest.mergeLock };
    },
    releaseMerge: async (id: string, lockId: string) => {
      const pullRequest = pullRequests.get(id);
      if (pullRequest?.mergeLock?.id !== lockId) return false;
      delete pullRequest.mergeLock;
      return true;
    },
    markMerged: vi.fn(async (id: string, lockId: string, merged: any) => {
      await run('markMerged');
      const pullRequest = pullRequests.get(id);
      if (!pullRequest || pullRequest.status !== 'open' || pullRequest.mergeLock?.id !== lockId) return null;
      pullRequest.status = 'merged';
      pullRequest.merged = structuredClone(merged);
      delete pullRequest.mergeLock;
      return copy(pullRequest);
    }),
    close: async (id: string, closed: any, now = new Date()) => {
      const pullRequest = pullRequests.get(id);
      if (!pullRequest || pullRequest.status !== 'open' || lockIsLive(pullRequest, now)) return null;
      pullRequest.status = 'closed';
      pullRequest.closed = closed;
      delete pullRequest.mergeLock;
      return copy(pullRequest);
    },
  };

  const blind = new Set(options.blind ?? []);
  const permissionService = {
    canReadPrivateVersions: async (reader: LeanUser) => !blind.has(reader.id),
    resolveOrgRole: async () => 'OWNER',
    buildBatchContext: async () => ({ entityPermissions: new Map(), orgPermissions: new Map() }),
  };
  const permissionEngine = { evaluate: vi.fn(() => ({ allowed: true, reason: '' })) };

  const pricingService = Object.assign(Object.create(PricingService.prototype), {
    pricingRepository,
    permissionService,
    permissionEngine,
    show: async (slug: string, organization: string) => {
      const identity = [...identities.values()].find(candidate => candidate.slug === slug && candidate.organizationId === organization)!;
      return {
        pricingId: identity.pricingId, name: identity.name, slug: identity.slug,
        versions: newestFirst(identity.pricingId).map(row => ({ id: row._id, version: row.version })),
      };
    },
  }) as unknown as PricingService;
  const notifier = {
    claimRound: async () => true,
    notifyMaintainers: async () => undefined,
    notifyMerged: async () => undefined,
    notifyClosed: async () => undefined,
  };
  const service = Object.assign(Object.create(PricingPullRequestService.prototype), {
    pricingPullRequestRepository: pullRequestRepository,
    pricingRepository,
    pricingCollectionRepository: { findSlugById: async () => undefined },
    userRepository: { findByIds: async (ids: string[]) => ids.map(id => user(id)) },
    permissionService,
    pricingService,
    notifier,
    permissionEngine,
    states: { get: () => undefined, set: () => undefined },
    forkChanges: { get: () => undefined, set: () => undefined },
    comparisons: { get: () => undefined, set: () => undefined },
  }) as unknown as PricingPullRequestService;

  const v1 = addVersion(pricingId, '1.0.0', pricingText(NAME, '1.0.0'));

  /** An up-to-date pull request on v1 by `authorId`, proposing `change` as version 2.0.0. */
  function openPullRequest(change: Change, authorId = AUTHOR.id) {
    const now = new Date();
    const pullRequest: PricingPullRequest = {
      id: objectId(), pricingId, number: pullRequests.size + 1, title: 'Change', description: '', authorId, status: 'open',
      base: { versionId: v1._id, version: '1.0.0', yaml: fs.readFileSync(requirePricingFile(v1.yaml), 'utf8') },
      proposed: { yaml: pricingText(NAME, '2.0.0', change), suggestedVersion: '2.0.0' },
      proposalRevision: 1, createdAt: now, updatedAt: now,
    };
    pullRequests.set(pullRequest.id, pullRequest);
    return pullRequest.id;
  }

  const mergePreview = (reqUser: LeanUser, id: string) => service.mergePreview(reqUser, id, { purpose: 'merge' });
  const merge = (reqUser: LeanUser, id: string, preview: { previewToken: string; suggestedVersion: string }, extra: Record<string, unknown> = {}) =>
    service.merge(reqUser, id, { version: preview.suggestedVersion, private: false, previewToken: preview.previewToken, ...extra });

  /** The files merges wrote for P (`<version>-pr-<time>-<uuid>.yml`). */
  const mergeFiles = () => {
    const folder = path.join(UPLOADED, organizationId, SLUG);
    return fs.existsSync(folder) ? fs.readdirSync(folder).filter(file => file.includes('-pr-')) : [];
  };

  return {
    pricingId, forkId, v1, versions, revisions, hooks, pullRequests, pricingRepository, pullRequestRepository, permissionEngine,
    service, pricingService, addVersion, openPullRequest, mergePreview, merge, mergeFiles,
  };
}

/** A hook that stops the store until `release` is called; `reached` resolves when it stops. */
function pause() {
  const reached = deferred();
  const release = deferred();
  return {
    reached: reached.promise,
    release: () => release.resolve(),
    hook: async () => {
      reached.resolve();
      await release.promise;
    },
  };
}

/** A hook that stops the first `count` callers until all of them arrived. */
function barrier(count: number) {
  const arrived = deferred();
  let waiting = 0;
  const release = deferred();
  return {
    arrived: arrived.promise,
    release: () => release.resolve(),
    hook: async () => {
      if (++waiting === count) arrived.resolve();
      if (waiting <= count) await release.promise;
    },
  };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as PullRequestError;
  }
  throw new Error('Expected a refusal');
}

afterEach(() => {
  for (const organization of organizations.splice(0)) fs.rmSync(path.join(UPLOADED, organization), { recursive: true, force: true });
});

describe('Merging pull requests at the same time as other writes', () => {
  it('(a) Publishes one of two merges that read the same revision; the other gets 409 and leaves nothing (CA-48).', async () => {
    const f = fixture();
    const a = f.openPullRequest(goldAt(7.5));
    const b = f.openPullRequest(platinumAt(12));
    const previews = [await f.mergePreview(OWNER, a), await f.mergePreview(OWNER, b)];
    const both = barrier(2);
    f.hooks.hasVersionLabel = both.hook;

    const merges = [f.merge(OWNER, a, previews[0], { version: '2.0.0' }), f.merge(OWNER, b, previews[1], { version: '2.1.0' })];
    await both.arrived;
    both.release();
    const results = await Promise.allSettled(merges);

    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const refused = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ status: 409, code: 'PRICING_CHANGED_DURING_MERGE' });
    expect(f.versions).toHaveLength(2);
    const loser = [a, b].find(id => f.pullRequests.get(id)!.status === 'open')!;
    expect(f.pullRequests.get(loser)!.mergeLock).toBeUndefined();
    expect(f.mergeFiles()).toHaveLength(1);
  });

  it('(b) Would publish both without the revision it read as precondition.', async () => {
    const f = fixture();
    const a = f.openPullRequest(goldAt(7.5));
    const b = f.openPullRequest(platinumAt(12));
    const previews = [await f.mergePreview(OWNER, a), await f.mergePreview(OWNER, b)];
    const createVersion = PricingService.prototype.createVersion;
    // The same publish, dropping the precondition the merge passes.
    f.pricingService.createVersion = function (this: PricingService, ...args: Parameters<PricingService['createVersion']>) {
      const [file, organizationId, slug, isPrivate, reqUser, collectionId, createdAt, , mergedFrom] = args;
      return createVersion.call(this, file, organizationId, slug, isPrivate, reqUser, collectionId, createdAt, undefined, mergedFrom);
    };
    const both = barrier(2);
    f.hooks.hasVersionLabel = both.hook;

    const merges = [f.merge(OWNER, a, previews[0], { version: '2.0.0' }), f.merge(OWNER, b, previews[1], { version: '2.1.0' })];
    await both.arrived;
    both.release();
    const results = await Promise.allSettled(merges);

    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(f.versions).toHaveLength(3);
  });

  it('(c) Refuses the merge when another version is published between reading the latest and publishing.', async () => {
    const f = fixture();
    const id = f.openPullRequest(goldAt(7.5));
    const preview = await f.mergePreview(OWNER, id);
    f.hooks.hasVersionLabel = async () => {
      delete f.hooks.hasVersionLabel;
      f.addVersion(f.pricingId, '1.5.0', pricingText(NAME, '1.5.0', platinumAt(40)));
    };

    const refused = await refusal(f.merge(OWNER, id, preview));

    expect(refused).toMatchObject({ status: 409, code: 'PRICING_CHANGED_DURING_MERGE' });
    expect(f.versions.map(row => row.version)).toEqual(['1.0.0', '1.5.0']);
    expect(f.pullRequests.get(id)).toMatchObject({ status: 'open' });
    expect(f.pullRequests.get(id)!.mergeLock).toBeUndefined();
    expect(f.mergeFiles()).toEqual([]);
  });

  it('(d) Removes the file and lets the pricing go when publishing fails, so the merge can be tried again.', async () => {
    const f = fixture();
    const id = f.openPullRequest(goldAt(7.5));
    const preview = await f.mergePreview(OWNER, id);
    f.hooks.create = async () => {
      delete f.hooks.create;
      throw new Error('storage failed');
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const refused = await refusal(f.merge(OWNER, id, preview)).finally(() => logged.mockRestore());

    expect(refused).toMatchObject({ status: 500, code: 'MERGE_FAILED' });
    expect(f.mergeFiles()).toEqual([]);
    expect(f.pullRequests.get(id)!.mergeLock).toBeUndefined();
    // Neither the pricing's queue nor the reservation is held: the same merge goes through.
    const merged = await f.merge(OWNER, id, preview);
    expect(merged.pullRequest.status).toBe('merged');
    expect(f.mergeFiles()).toHaveLength(1);
  });

  it('(e) Refuses edits and updates while it is merged, and publishes the proposal that was reviewed (CA-92).', async () => {
    const f = fixture();
    const id = f.openPullRequest(goldAt(7.5));
    const preview = await f.mergePreview(OWNER, id);
    const publishing = pause();
    f.hooks.create = publishing.hook;

    const merging = f.merge(OWNER, id, preview);
    await publishing.reached;
    const edit = await refusal(f.service.edit(AUTHOR, id, { proposedYaml: pricingText(NAME, '2.0.0', goldAt(99)) }));
    const update = await refusal(f.service.update(AUTHOR, id, { previewToken: 'x.y' }));
    publishing.release();
    const merged = await merging;

    expect(edit).toMatchObject({ status: 409, code: 'PULL_REQUEST_MERGING' });
    expect(update).toMatchObject({ status: 409, code: 'PULL_REQUEST_MERGING' });
    expect(merged.pullRequest.status).toBe('merged');
    expect(f.pullRequests.get(id)!.merged).toMatchObject({ proposalRevision: 1, versionId: merged.version.id });
    const published = f.versions.find(row => row._id === merged.version.id)!;
    expect((loadPricingDoc(fs.readFileSync(requirePricingFile(published.yaml), 'utf8'), STORED_PRICING_MAX_BYTES) as any).plans.GOLD.price).toBe(7.5);
  });

  it('(f) Refuses closing it while it is merged.', async () => {
    const f = fixture();
    const id = f.openPullRequest(goldAt(7.5));
    const preview = await f.mergePreview(OWNER, id);
    const publishing = pause();
    f.hooks.create = publishing.hook;

    const merging = f.merge(OWNER, id, preview);
    await publishing.reached;
    const closing = await refusal(f.service.close(AUTHOR, id));
    publishing.release();
    await merging;

    expect(closing).toMatchObject({ status: 409, code: 'PULL_REQUEST_MERGING' });
    expect(f.pullRequests.get(id)!.status).toBe('merged');
  });

  it('(g, i) Marks it merged on the next load when the merge stopped after publishing, keeping the published file (CA-92).', async () => {
    const f = fixture();
    const id = f.openPullRequest(goldAt(7.5));
    const preview = await f.mergePreview(OWNER, id);
    f.hooks.markMerged = async () => {
      delete f.hooks.markMerged;
      throw new Error('the process went down');
    };

    await expect(f.merge(OWNER, id, preview)).rejects.toThrow('the process went down');
    const published = f.versions.find(row => row.mergedFrom?.prId === id)!;
    expect(published).toBeDefined();
    expect(fs.existsSync(requirePricingFile(published.yaml))).toBe(true);
    expect(f.pullRequests.get(id)).toMatchObject({ status: 'open', mergeLock: { revision: 1 } });

    const shown = await f.service.show(AUTHOR, id);

    expect(shown).toMatchObject({ status: 'merged', merged: { versionId: published._id, version: '2.0.0' } });
    expect(f.pullRequests.get(id)!.merged).toMatchObject({ byId: OWNER.id, proposalRevision: 1 });
    expect(f.pullRequests.get(id)!.mergeLock).toBeUndefined();
  });

  it('(h) Gives the reservation back when the publish is refused, so other operations go on (CA-92).', async () => {
    const f = fixture();
    const id = f.openPullRequest(goldAt(7.5));
    const preview = await f.mergePreview(OWNER, id);
    // The merger lost CREATE between the merge's checks and the publish's.
    Object.assign(f.pricingService, { permissionEngine: { evaluate: () => ({ allowed: false, reason: 'No CREATE' }) } });

    const refused = await refusal(f.merge(OWNER, id, preview));

    expect(refused).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(f.pullRequests.get(id)!.mergeLock).toBeUndefined();
    expect(f.mergeFiles()).toEqual([]);
    expect(f.versions).toHaveLength(1);
    const edited = await f.service.edit(AUTHOR, id, { title: 'Still open' });
    expect(edited).toMatchObject({ title: 'Still open', status: 'open' });
  });

  it('(j) Merges for a maintainer who may not read private versions, without giving them the ETag (T8).', async () => {
    const f = fixture({ blind: ['blind'] });
    const id = f.openPullRequest(goldAt(7.5));
    const preview = await f.mergePreview(user('blind'), id);

    const merged = await f.merge(user('blind'), id, preview);

    expect(merged.pullRequest.status).toBe('merged');
    expect(merged.etag).toBeUndefined();
    expect(f.versions).toHaveLength(2);
    // Who may read it gets the new tag.
    const other = f.openPullRequest(platinumAt(12));
    const ownerMerge = await f.merge(OWNER, other, await f.mergePreview(OWNER, other), { version: '3.0.0' });
    expect(ownerMerge.etag).toBe(`"${f.pricingId}.${f.revisions.get(f.pricingId)}"`);
  });

  it('(k) Claims the revision naming the pricing by its string id, as the repository compares it.', async () => {
    const f = fixture();
    const id = f.openPullRequest(goldAt(7.5));
    const preview = await f.mergePreview(OWNER, id);
    const revision = f.revisions.get(f.pricingId);

    await f.merge(OWNER, id, preview);

    expect(f.pricingRepository.claimRevision).toHaveBeenCalledWith(f.pricingId, { kind: 'tags', tags: [{ pricingId: f.pricingId, revision }] });
    const [, precondition] = f.pricingRepository.claimRevision.mock.calls[0];
    expect(typeof (precondition as Extract<PricingPrecondition, { kind: 'tags' }>).tags[0].pricingId).toBe('string');
  });

  it('(l) Opens one pull request for two proposals from the same fork sent at once (CA-96).', async () => {
    const f = fixture();
    f.addVersion(f.forkId, '1.0.0', pricingText('Fork', '1.0.0'), { forkedFrom: f.pricingId });
    f.addVersion(f.forkId, '1.1.0', pricingText('Fork', '1.1.0', goldAt(30)));
    const forker = user('forker');
    const preview = await f.service.preview(forker, { source: { kind: 'fork', forkPricingId: f.forkId } });
    const creating = pause();
    f.hooks.createPullRequest = creating.hook;

    const body = { title: 'From the fork', source: { kind: 'fork' as const, forkPricingId: f.forkId }, previewToken: preview.previewToken };
    const first = f.service.proposeFromFork(forker, body);
    await creating.reached;
    delete f.hooks.createPullRequest;
    const second = f.service.proposeFromFork(forker, body);
    creating.release();
    const results = await Promise.all([first, second]);

    expect(results.map(result => result.created)).toEqual([true, false]);
    expect(f.pullRequests.size).toBe(1);
    expect(f.pullRequestRepository.create).toHaveBeenCalledTimes(1);
    expect([...f.pullRequests.values()][0]).toMatchObject({ number: 1, proposalRevision: 2 });
  });
});
