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
  // Ensure all collections belong to an organization
  const collectionsWithoutOrg = await db
    .collection('pricingCollections')
    .countDocuments({ _organizationId: { $exists: false } });

  const collectionsWithNullOrg = await db
    .collection('pricingCollections')
    .countDocuments({ _organizationId: null });

  if (collectionsWithoutOrg > 0 || collectionsWithNullOrg > 0) {
    throw new Error(
      `Cannot run collection slug migration: ${
        collectionsWithoutOrg + collectionsWithNullOrg
      } collections missing _organizationId.`
    );
  }

  // Group collections that should share the same slug
  const groups = await db
    .collection('pricingCollections')
    .aggregate([
      {
        $group: {
          _id: {
            name: '$name',
            orgId: '$_organizationId',
          },
          docs: {
            $push: {
              _id: '$_id',
            },
          },
        },
      },
      {
        $sort: {
          '_id.name': 1,
        },
      },
    ])
    .toArray();

  const usedSlugsPerOrg = new Map<string, Set<string>>();

  for (const group of groups) {
    const orgId = group._id.orgId.toString();

    if (!usedSlugsPerOrg.has(orgId)) {
      usedSlugsPerOrg.set(orgId, new Set());
    }

    const usedSlugs = usedSlugsPerOrg.get(orgId)!;

    const baseSlug = generateSlug(group._id.name);

    let slug = baseSlug;
    let counter = 1;

    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${counter++}`;
    }

    usedSlugs.add(slug);

    await db.collection('pricingCollections').updateMany(
      {
        _id: {
          $in: group.docs.map((d: any) => d._id),
        },
      },
      {
        $set: {
          slug,
        },
      }
    );
  }

  await db.collection('pricingCollections').createIndex(
    {
      slug: 1,
      _organizationId: 1,
    },
    {
      unique: true,
      name: 'slug_1__organizationId_1',
    }
  );
}

export async function down(db: mongoose.Connection) {
  try {
    const indexes = await db.collection('pricingCollections').indexes();

    const slugIndex = indexes.find(
      (i: any) =>
        i.unique &&
        i.key.slug === 1 &&
        i.key._organizationId === 1
    );

    if (slugIndex) {
      await db.collection('pricingCollections').dropIndex(slugIndex.name || "");
    }
  } catch {
    // ignore
  }

  await db.collection('pricingCollections').updateMany(
    {},
    {
      $unset: {
        slug: '',
      },
    }
  );
}