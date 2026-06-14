import mongoose from 'mongoose';

function generateSlug(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function up(db: mongoose.Connection) {
  const DEFAULT_ORGANIZATION_ID = new mongoose.Types.ObjectId(
    '6a2d90d2e7661f8a65098f97'
  );

  const organizations = await db
    .collection('organizations')
    .find({})
    .toArray();

  const orgByOwnerId = new Map<string, any>();

  for (const org of organizations) {
    if (org._ownerId) {
      orgByOwnerId.set(org._ownerId.toString(), org);
    }
  }

  const collections = await db
    .collection('pricingCollections')
    .find({})
    .sort({ name: 1 })
    .toArray();

  const usedSlugsPerOrg = new Map<string, Set<string>>();

  for (const collection of collections) {
    const organization = collection._ownerId
      ? orgByOwnerId.get(collection._ownerId.toString())
      : undefined;

    const organizationId =
      organization?._id ?? DEFAULT_ORGANIZATION_ID;

    const orgKey = organizationId.toString();

    if (!usedSlugsPerOrg.has(orgKey)) {
      usedSlugsPerOrg.set(orgKey, new Set());
    }

    const usedSlugs = usedSlugsPerOrg.get(orgKey)!;

    const baseSlug = generateSlug(
      collection.name ?? 'collection'
    );

    let slug = baseSlug;
    let counter = 1;

    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${counter++}`;
    }

    usedSlugs.add(slug);

    if (!organization) {
      console.warn(
        `[pricingCollections] No personal organization found for owner ${collection._ownerId}. Using fallback organization ${DEFAULT_ORGANIZATION_ID}.`
      );
    }

    await db.collection('pricingCollections').updateOne(
      { _id: collection._id },
      {
        $set: {
          slug,
          _organizationId: organizationId,
        },
        $unset: {
          _ownerId: '',
        },
      }
    );
  }
}

export async function down(db: mongoose.Connection) {
  await db.collection('pricingCollections').updateMany(
    {},
    {
      $unset: {
        slug: '',
        _organizationId: '',
      },
    }
  );
}