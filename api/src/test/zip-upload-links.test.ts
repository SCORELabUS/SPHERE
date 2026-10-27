/**
 * The script that links pricings uploaded in a ZIP before the bulk upload
 * stored their collection (`scripts/link-zip-uploads-to-collections.ts`).
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { shutdownApp } from './utils/testApp';
import testContainer from './utils/config/testContainer';
import { randomSuffix } from './utils/helpers';
import PricingMongoose from '../main/repositories/mongoose/models/PricingMongoose';
import PricingCollectionMongoose from '../main/repositories/mongoose/models/PricingCollectionMongoose';
import { applyZipUploadLinks, planZipUploadLinks, ZipUploadPlan } from '../main/utils/zip-upload-links';

dotenv.config();

describe('Linking ZIP uploads to their collections', { timeout: 60000 }, () => {
  const organizations: string[] = [];
  const root = (process.env.COLLECTIONS_FOLDER || 'static/collections').replace(/\/+$/, '');

  beforeAll(async () => {
    testContainer.resolve('app');
  });

  afterEach(async () => {
    const ids = organizations.splice(0).map(id => new mongoose.Types.ObjectId(id));
    await PricingMongoose.deleteMany({ _organizationId: { $in: ids } });
    await PricingCollectionMongoose.deleteMany({ _organizationId: { $in: ids } });
  });

  afterAll(async () => {
    await shutdownApp();
  });

  const newOrganization = () => {
    const id = new mongoose.Types.ObjectId().toString();
    organizations.push(id);
    return id;
  };

  const collection = async (organizationId: string, name: string, slug: string) => {
    const created = await PricingCollectionMongoose.create({ name, slug, _organizationId: organizationId, private: false });
    return String(created._id);
  };

  /** A pricing version as the old bulk upload stored it: no collection, its file in the upload folder. */
  const version = async (
    organizationId: string,
    name: string,
    label: string,
    file: string,
    collectionId?: string
  ) =>
    PricingMongoose.create({
      name,
      version: label,
      _organizationId: organizationId,
      ...(collectionId ? { _collectionId: collectionId } : {}),
      currency: 'USD',
      createdAt: new Date(),
      url: '',
      yaml: file,
      private: false,
    });

  const ours = (plan: ZipUploadPlan) => {
    const mine = (entry: { organizationId: string }) => organizations.includes(entry.organizationId);
    return {
      link: plan.link.filter(mine),
      ambiguous: plan.ambiguous.filter(mine),
      unmatched: plan.unmatched.filter(mine),
      alreadyInCollection: plan.alreadyInCollection.filter(mine),
    };
  };

  const collectionOf = async (organizationId: string, slug: string) => {
    const rows: any[] = await PricingMongoose.find({ _organizationId: organizationId, slug }).lean();
    return [...new Set(rows.map(row => row._collectionId ?? null))];
  };

  /**
   * Organization A: an upload folder named after a collection's name and
   * another after a collection's slug; a renamed and a deleted collection; a
   * folder two collections could stand for; a pricing already in a
   * collection; and a version whose file lies in organization B's folder.
   * Organization B has a collection with the same name as one of A's.
   */
  const fixtures = async () => {
    const a = newOrganization();
    const b = newOrganization();
    const suffix = randomSuffix().toLowerCase();
    const named = await collection(a, `Telecom ${suffix}`, `telecom-${suffix}`);
    const slugged = await collection(a, `Cloud ${suffix}`, `cloud-${suffix}`);
    await collection(a, `Renamed ${suffix}`, `renamed-${suffix}`);
    const alpha = await collection(a, `alpha ${suffix}`, `alpha-${suffix}`);
    await collection(a, `alpha-${suffix}`, `alpha-${suffix}-2`);
    const sharedInA = await collection(a, `Shared ${suffix}`, `shared-${suffix}`);
    const sharedInB = await collection(b, `Shared ${suffix}`, `shared-${suffix}`);
    const elsewhere = await collection(a, `Elsewhere ${suffix}`, `elsewhere-${suffix}`);

    const at = (organizationId: string, folder: string, file: string) => `${root}/${organizationId}/${folder}/${file}`;
    await version(a, `Phone${suffix}`, '1.0', at(a, `Telecom ${suffix}`, 'phone-1.yml'));
    await version(a, `Phone${suffix}`, '2.0', at(a, `Telecom ${suffix}`, 'phone-2.yml'));
    await version(a, `Storage${suffix}`, '1.0', at(a, `cloud-${suffix}`, 'storage.yml'));
    await version(a, `Legacy${suffix}`, '1.0', at(a, `Old name ${suffix}`, 'legacy.yml'));
    await version(a, `Orphan${suffix}`, '1.0', at(a, `Deleted ${suffix}`, 'orphan.yml'));
    await version(a, `Twofold${suffix}`, '1.0', at(a, `alpha-${suffix}`, 'twofold.yml'));
    await version(a, `Local${suffix}`, '1.0', at(a, `Shared ${suffix}`, 'local.yml'));
    await version(a, `Foreign${suffix}`, '1.0', at(b, `Shared ${suffix}`, 'foreign.yml'));
    await version(a, `Placed${suffix}`, '1.0', at(a, `Telecom ${suffix}`, 'placed.yml'), elsewhere);
    const slug = (name: string) => `${name.toLowerCase()}${suffix}`;
    return { a, b, suffix, slug, named, slugged, alpha, sharedInA, sharedInB, elsewhere };
  };

  it('lists the unambiguous links and the cases it leaves alone, changing nothing on a dry run', async () => {
    const f = await fixtures();
    const before = await PricingMongoose.find({ _organizationId: { $in: [f.a, f.b] } }).sort({ _id: 1 }).lean();

    const plan = ours(await planZipUploadLinks());

    expect(plan.link.map(entry => [entry.slug, entry.collection.id, entry.versions])).toEqual([
      [f.slug('Phone'), f.named, 2],
      [f.slug('Local'), f.sharedInA, 1],
      [f.slug('Storage'), f.slugged, 1],
    ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))));
    // Same folder name in two organizations: the pricing goes to its own organization's collection.
    expect(plan.link.find(entry => entry.slug === f.slug('Local'))?.collection.id).not.toBe(f.sharedInB);

    const reasons = (entries: Array<{ slug: string; reason: string }>) =>
      Object.fromEntries(entries.map(entry => [entry.slug, entry.reason]));
    expect(reasons(plan.unmatched)).toEqual({
      [f.slug('Legacy')]: expect.stringContaining('renamed or deleted'),
      [f.slug('Orphan')]: expect.stringContaining('renamed or deleted'),
    });
    expect(reasons(plan.ambiguous)).toEqual({
      [f.slug('Twofold')]: 'the folder matches more than one collection',
      [f.slug('Foreign')]: 'its files are in the folder of another organization',
    });
    expect(plan.ambiguous.find(entry => entry.slug === f.slug('Twofold'))?.candidates?.map(candidate => candidate.id)).toContain(f.alpha);
    expect(plan.alreadyInCollection.map(entry => entry.slug)).toEqual([f.slug('Placed')]);

    const after = await PricingMongoose.find({ _organizationId: { $in: [f.a, f.b] } }).sort({ _id: 1 }).lean();
    expect(after).toEqual(before);
  });

  it('links only the unambiguous pricings, never one already in a collection, and is idempotent', async () => {
    const f = await fixtures();
    const refreshed: string[] = [];
    const lines: string[] = [];

    const first = await applyZipUploadLinks({ onLinked: async id => void refreshed.push(id), log: line => lines.push(line) });
    const linked = first.linked.filter(entry => entry.organizationId === f.a);
    expect(linked.map(entry => entry.updatedVersions).reduce((x, y) => x + y, 0)).toBe(4);
    expect(refreshed).toEqual(expect.arrayContaining([f.named, f.slugged, f.sharedInA]));
    expect(lines.some(line => line.includes(f.slug('Phone')) && line.includes(f.named))).toBe(true);

    expect(await collectionOf(f.a, f.slug('Phone'))).toEqual([f.named]);
    expect(await collectionOf(f.a, f.slug('Storage'))).toEqual([f.slugged]);
    expect(await collectionOf(f.a, f.slug('Local'))).toEqual([f.sharedInA]);
    for (const name of ['Legacy', 'Orphan', 'Twofold', 'Foreign']) {
      expect(await collectionOf(f.a, f.slug(name))).toEqual([null]);
    }
    expect(await collectionOf(f.a, f.slug('Placed'))).toEqual([f.elsewhere]);
    expect(await PricingMongoose.countDocuments({ _organizationId: f.b })).toBe(0);

    // Run again: nothing left to link, and what was linked stays as it is.
    const again = await applyZipUploadLinks();
    expect(again.linked.filter(entry => organizations.includes(entry.organizationId))).toEqual([]);
    const plan = ours(again.plan);
    expect(plan.alreadyInCollection.map(entry => entry.slug).sort()).toEqual(
      [f.slug('Local'), f.slug('Phone'), f.slug('Placed'), f.slug('Storage')].sort()
    );
    expect(await collectionOf(f.a, f.slug('Phone'))).toEqual([f.named]);
  });
});
