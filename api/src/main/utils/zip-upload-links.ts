/**
 * Links pricings uploaded in a ZIP (`POST /collections/{organizationId}/bulk`)
 * to the collection they were uploaded with.
 *
 * Before the fix in `PricingCollectionService.bulkCreate`, those pricings were
 * stored without `_collectionId`, so they never showed up in their collection.
 * Their files still tell where they came from: the upload extracted them under
 * `<COLLECTIONS_FOLDER>/<organizationId>/<folder>/`, the folder being named
 * after the collection (its name at upload time, its slug once renamed).
 *
 * The plan is conservative: a pricing is linked only when it has no
 * collection, every stored file of it under the collections folder lies in
 * one folder of its own organization, and exactly one collection of that
 * organization has that folder's name or slug. Anything else is reported and
 * left alone. Applying it is idempotent: a linked pricing has a collection and
 * is never looked at again.
 *
 * Run it with `scripts/link-zip-uploads-to-collections.ts`.
 */
import mongoose from 'mongoose';
import PricingMongoose from '../repositories/mongoose/models/PricingMongoose';
import PricingCollectionMongoose from '../repositories/mongoose/models/PricingCollectionMongoose';
import PricingIdentity from '../repositories/mongoose/models/PricingIdentityMongoose';

export interface ZipUploadPricing {
  organizationId: string;
  pricingId: string | null;
  slug: string;
  name: string;
  versions: number;
  /** The folders under `<COLLECTIONS_FOLDER>/<organizationId>/` its files are in. */
  folders: string[];
}

export interface ZipUploadLink extends ZipUploadPricing {
  collection: { id: string; name: string; slug: string };
}

export interface ZipUploadCase extends ZipUploadPricing {
  reason: string;
  /** The collections the folder could stand for, when there are several. */
  candidates?: Array<{ id: string; name: string; slug: string }>;
}

export interface ZipUploadPlan {
  /** Pricings that map unambiguously to one collection: the ones `--apply` links. */
  link: ZipUploadLink[];
  /** Pricings whose folder could be more than one collection, or that cannot be linked safely. */
  ambiguous: ZipUploadCase[];
  /** Pricings whose folder matches no collection of their organization (renamed or deleted). */
  unmatched: ZipUploadCase[];
  /** Pricings with files in the collections folder that already have a collection: never touched. */
  alreadyInCollection: ZipUploadPricing[];
}

const NO_COLLECTION = [{ _collectionId: null }, { _collectionId: { $exists: false } }, { _collectionId: '' }];

function collectionsFolder(): string {
  return (process.env.COLLECTIONS_FOLDER || 'static/collections').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `<organizationId>/<folder>` of a stored file under the collections folder, or null. */
function locate(yaml: unknown, root: string): { organizationId: string; folder: string } | null {
  if (typeof yaml !== 'string') return null;
  const normalized = yaml.replace(/\\/g, '/');
  if (!normalized.startsWith(`${root}/`)) return null;
  const segments = normalized.slice(root.length + 1).split('/');
  if (segments.length < 3 || segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null;
  return { organizationId: segments[0], folder: segments[1] };
}

function decoded(folder: string): string {
  try {
    return decodeURIComponent(folder);
  } catch {
    return folder;
  }
}

/** Works out what `--apply` would do, changing nothing. */
export async function planZipUploadLinks(): Promise<ZipUploadPlan> {
  const root = collectionsFolder();
  const plan: ZipUploadPlan = { link: [], ambiguous: [], unmatched: [], alreadyInCollection: [] };

  // Versions stored under the collections folder; their pricings are the candidates.
  const stored: any[] = await PricingMongoose.find({ yaml: { $regex: `^${escapeRegex(root)}/` } })
    .select('pricingId slug name _organizationId')
    .lean();
  const families = new Map<string, { organizationId: string; slug: string; pricingId: string | null }>();
  for (const version of stored) {
    const organizationId = String(version._organizationId);
    const slug = String(version.slug ?? '');
    const key = `${organizationId}:${slug}`;
    if (!families.has(key)) families.set(key, { organizationId, slug, pricingId: version.pricingId ? String(version.pricingId) : null });
  }

  const collectionsByOrganization = new Map<string, Array<{ id: string; name: string; slug: string }>>();
  const collectionsOf = async (organizationId: string) => {
    if (!collectionsByOrganization.has(organizationId)) {
      const rows: any[] = mongoose.isValidObjectId(organizationId)
        ? await PricingCollectionMongoose.find({ _organizationId: new mongoose.Types.ObjectId(organizationId) })
            .select('_id name slug')
            .lean()
        : [];
      collectionsByOrganization.set(organizationId, rows.map(row => ({ id: String(row._id), name: row.name, slug: row.slug })));
    }
    return collectionsByOrganization.get(organizationId)!;
  };

  for (const family of families.values()) {
    // Every version of the pricing, wherever its file is: a pricing moves as a whole.
    const versions: any[] = await PricingMongoose.find({
      _organizationId: new mongoose.Types.ObjectId(family.organizationId),
      slug: family.slug,
    })
      .select('name yaml _collectionId _organizationId')
      .lean();
    const located = versions.map(version => locate(version.yaml, root)).filter(Boolean) as Array<{ organizationId: string; folder: string }>;
    const pricing: ZipUploadPricing = {
      organizationId: family.organizationId,
      pricingId: family.pricingId,
      slug: family.slug,
      name: versions[0]?.name ?? family.slug,
      versions: versions.length,
      folders: [...new Set(located.map(entry => entry.folder))].sort(),
    };

    if (versions.some(version => typeof version._collectionId === 'string' && version._collectionId !== '')) {
      plan.alreadyInCollection.push(pricing);
      continue;
    }
    if (!family.slug) {
      plan.ambiguous.push({ ...pricing, reason: 'the pricing has no slug' });
      continue;
    }
    if (located.length === 0) {
      plan.unmatched.push({ ...pricing, reason: 'its files are not inside a collection folder' });
      continue;
    }
    if (located.some(entry => entry.organizationId !== family.organizationId)) {
      plan.ambiguous.push({ ...pricing, reason: 'its files are in the folder of another organization' });
      continue;
    }
    if (pricing.folders.length > 1) {
      plan.ambiguous.push({ ...pricing, reason: 'its versions are in different collection folders' });
      continue;
    }

    const folder = pricing.folders[0];
    const names = new Set([folder, decoded(folder)]);
    const candidates = (await collectionsOf(family.organizationId)).filter(
      collection => names.has(collection.slug) || names.has(collection.name)
    );
    if (candidates.length === 0) {
      plan.unmatched.push({
        ...pricing,
        reason: 'no collection of its organization has this folder as name or slug (renamed or deleted)',
      });
      continue;
    }
    if (candidates.length > 1) {
      plan.ambiguous.push({ ...pricing, reason: 'the folder matches more than one collection', candidates });
      continue;
    }

    // Two pricings with the same slug cannot end up in one collection.
    const identityClash = await PricingIdentity.exists({
      _organizationId: new mongoose.Types.ObjectId(family.organizationId),
      slug: family.slug,
      _collectionId: candidates[0].id,
      deleted: false,
      ...(family.pricingId ? { _id: { $ne: new mongoose.Types.ObjectId(family.pricingId) } } : {}),
    });
    if (identityClash) {
      plan.ambiguous.push({ ...pricing, reason: 'the collection already has a pricing with this slug', candidates });
      continue;
    }

    plan.link.push({ ...pricing, collection: candidates[0] });
  }

  const order = (a: ZipUploadPricing, b: ZipUploadPricing) =>
    a.organizationId.localeCompare(b.organizationId) || a.slug.localeCompare(b.slug);
  plan.link.sort(order);
  plan.ambiguous.sort(order);
  plan.unmatched.sort(order);
  plan.alreadyInCollection.sort(order);
  return plan;
}

export interface ZipUploadApplyResult {
  plan: ZipUploadPlan;
  linked: Array<ZipUploadLink & { updatedVersions: number }>;
}

/**
 * Links the pricings `planZipUploadLinks` finds unambiguous, worked out again
 * at the time it runs. Versions that have a collection by then are never
 * changed. `onLinked` is called once per collection that got pricings (to
 * refresh its analytics).
 */
export async function applyZipUploadLinks(
  options: { onLinked?: (collectionId: string) => Promise<void>; log?: (line: string) => void } = {}
): Promise<ZipUploadApplyResult> {
  const plan = await planZipUploadLinks();
  const linked: ZipUploadApplyResult['linked'] = [];
  const touched = new Set<string>();
  for (const entry of plan.link) {
    const result = await PricingMongoose.updateMany(
      {
        _organizationId: new mongoose.Types.ObjectId(entry.organizationId),
        slug: entry.slug,
        $or: NO_COLLECTION,
      },
      { $set: { _collectionId: entry.collection.id } }
    );
    linked.push({ ...entry, updatedVersions: result.modifiedCount });
    if (result.modifiedCount > 0) touched.add(entry.collection.id);
    options.log?.(
      `linked ${entry.organizationId}/${entry.slug} (${result.modifiedCount} version${result.modifiedCount === 1 ? '' : 's'}) to collection "${entry.collection.name}" (${entry.collection.id})`
    );
  }
  for (const collectionId of touched) {
    await options.onLinked?.(collectionId);
  }
  return { plan, linked };
}

/** The plan as text, for the console. */
export function describeZipUploadPlan(plan: ZipUploadPlan): string {
  const pricing = (entry: ZipUploadPricing) =>
    `${entry.organizationId}/${entry.slug} ("${entry.name}", ${entry.versions} version${entry.versions === 1 ? '' : 's'}, folder${entry.folders.length === 1 ? '' : 's'} ${entry.folders.map(folder => `"${folder}"`).join(', ') || 'none'})`;
  const lines: string[] = [];
  lines.push(`To link (${plan.link.length}):`);
  for (const entry of plan.link) lines.push(`  ${pricing(entry)} -> collection "${entry.collection.name}" (${entry.collection.id})`);
  lines.push(`Ambiguous, left alone (${plan.ambiguous.length}):`);
  for (const entry of plan.ambiguous) {
    const candidates = entry.candidates?.length
      ? ` [candidates: ${entry.candidates.map(candidate => `"${candidate.name}" (${candidate.id})`).join(', ')}]`
      : '';
    lines.push(`  ${pricing(entry)}: ${entry.reason}${candidates}`);
  }
  lines.push(`Unmatched, left alone (${plan.unmatched.length}):`);
  for (const entry of plan.unmatched) lines.push(`  ${pricing(entry)}: ${entry.reason}`);
  lines.push(`Already in a collection, never touched (${plan.alreadyInCollection.length}):`);
  for (const entry of plan.alreadyInCollection) lines.push(`  ${pricing(entry)}`);
  return lines.join('\n');
}
