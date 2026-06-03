import mongoose from 'mongoose';
import crypto from 'crypto';

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
  // ── Step 1: Add slug to all pricings ──
  // Group by name + _organizationId to assign the same slug to all versions of a pricing
  const pricingGroups = await db
    .collection('pricings')
    .aggregate([
      {
        $group: {
          _id: { name: '$name', orgId: '$_organizationId' },
          docs: { $push: { _id: '$_id' } },
        },
      },
    ])
    .toArray();

  // Collect all slugs per org to detect collisions across different pricing names
  const orgSlugsMap = new Map<string, Set<string>>();

  for (const group of pricingGroups) {
    const baseSlug = generateSlug(group._id.name);
    const orgId = group._id.orgId.toString();

    if (!orgSlugsMap.has(orgId)) {
      orgSlugsMap.set(orgId, new Set());
    }
    const orgSlugs = orgSlugsMap.get(orgId)!;

    let slug = baseSlug;
    // Deduplicate: if slug already used by another pricing in the same org, add suffix
    if (orgSlugs.has(slug)) {
      const suffix = crypto.randomBytes(5).readUInt32BE(0).toString().slice(0, 10);
      slug = `${baseSlug}-${suffix}`;
    }
    orgSlugs.add(slug);

    // Update all versions of this pricing with the same slug
    await db
      .collection('pricings')
      .updateMany({ _id: { $in: group.docs.map((d: any) => d._id) } }, { $set: { slug } });
  }

  // ── Step 2: Add unique index on pricings for slug + _organizationId + version + _collectionId ──
  await db
    .collection('pricings')
    .createIndex({ slug: 1, _organizationId: 1, version: 1, _collectionId: 1 }, { unique: true });

  // ── Step 3: Rename entityId → entitySlug in entityPermissions ──
  // For pricing permissions: resolve entityId (ObjectId) → pricing slug
  const pricingPerms = await db
    .collection('entityPermissions')
    .find({ entityType: 'pricing', entityId: { $ne: null } })
    .toArray();

  for (const perm of pricingPerms) {
    const pricing = await db.collection('pricings').findOne({ _id: perm.entityId });
    if (pricing && pricing.slug) {
      await db
        .collection('entityPermissions')
        .updateOne(
          { _id: perm._id },
          { $set: { entitySlug: pricing.slug }, $unset: { entityId: '' } }
        );
    } else {
      // Pricing not found (orphaned permission), remove entityId
      await db
        .collection('entityPermissions')
        .updateOne({ _id: perm._id }, { $set: { entitySlug: null }, $unset: { entityId: '' } });
    }
  }

  // For collection permissions: resolve entityId (ObjectId) → collection slug
  const collectionPerms = await db
    .collection('entityPermissions')
    .find({ entityType: 'collection', entityId: { $ne: null } })
    .toArray();

  for (const perm of collectionPerms) {
    const collection = await db.collection('pricingCollections').findOne({ _id: perm.entityId });
    if (collection && collection.slug) {
      await db
        .collection('entityPermissions')
        .updateOne(
          { _id: perm._id },
          { $set: { entitySlug: collection.slug }, $unset: { entityId: '' } }
        );
    } else {
      await db
        .collection('entityPermissions')
        .updateOne({ _id: perm._id }, { $set: { entitySlug: null }, $unset: { entityId: '' } });
    }
  }

  // For org-scoped permissions (entityId = null): set entitySlug = null
  await db
    .collection('entityPermissions')
    .updateMany({ entityId: null }, { $set: { entitySlug: null }, $unset: { entityId: '' } });

  // ── Step 4: Drop old entityId unique index, create new entitySlug index ──
  try {
    const indexes = await db.collection('entityPermissions').indexes();
    const oldIndex = indexes.find(
      (i: any) =>
        i.unique &&
        i.key._userId === 1 &&
        i.key._organizationId === 1 &&
        i.key.entityType === 1 &&
        i.key.entityId === 1
    );
    if (oldIndex) {
      await db.collection('entityPermissions').dropIndex(oldIndex.name || "");
    }
  } catch {
    // ignore
  }

  await db
    .collection('entityPermissions')
    .createIndex(
      { _userId: 1, _organizationId: 1, entityType: 1, entitySlug: 1 },
      { unique: true }
    );
}

export async function down(db: mongoose.Connection) {
  // ── Reverse: entitySlug → entityId ──

  // For pricing permissions: resolve slug → pricing _id
  const pricingPerms = await db
    .collection('entityPermissions')
    .find({ entityType: 'pricing', entitySlug: { $ne: null } })
    .toArray();

  for (const perm of pricingPerms) {
    const pricing = await db.collection('pricings').findOne({ slug: perm.entitySlug });
    if (pricing) {
      await db
        .collection('entityPermissions')
        .updateOne(
          { _id: perm._id },
          { $set: { entityId: pricing._id }, $unset: { entitySlug: '' } }
        );
    } else {
      await db
        .collection('entityPermissions')
        .updateOne({ _id: perm._id }, { $set: { entityId: null }, $unset: { entitySlug: '' } });
    }
  }

  // For collection permissions: resolve slug → collection _id
  const collectionPerms = await db
    .collection('entityPermissions')
    .find({ entityType: 'collection', entitySlug: { $ne: null } })
    .toArray();

  for (const perm of collectionPerms) {
    const collection = await db.collection('pricingCollections').findOne({ slug: perm.entitySlug });
    if (collection) {
      await db
        .collection('entityPermissions')
        .updateOne(
          { _id: perm._id },
          { $set: { entityId: collection._id }, $unset: { entitySlug: '' } }
        );
    } else {
      await db
        .collection('entityPermissions')
        .updateOne({ _id: perm._id }, { $set: { entityId: null }, $unset: { entitySlug: '' } });
    }
  }

  // For org-scoped permissions
  await db
    .collection('entityPermissions')
    .updateMany({ entitySlug: null }, { $set: { entityId: null }, $unset: { entitySlug: '' } });

  // Drop entitySlug index, recreate entityId index
  try {
    const indexes = await db.collection('entityPermissions').indexes();
    const idx = indexes.find(
      (i: any) =>
        i.unique &&
        i.key._userId === 1 &&
        i.key._organizationId === 1 &&
        i.key.entityType === 1 &&
        i.key.entitySlug === 1
    );
    if (idx) {
      await db.collection('entityPermissions').dropIndex(idx.name || "");
    }
  } catch {
    // ignore
  }

  await db
    .collection('entityPermissions')
    .createIndex({ _userId: 1, _organizationId: 1, entityType: 1, entityId: 1 }, { unique: true });

  // Remove slug field from pricings
  await db.collection('pricings').updateMany({}, { $unset: { slug: '' } });

  try {
    const indexes = await db.collection('pricings').indexes();
    const slugIndex = indexes.find(
      (i: any) => i.unique && i.key.slug === 1 && i.key._organizationId === 1 && i.key.version === 1
    );
    if (slugIndex) {
      await db.collection('pricings').dropIndex(slugIndex.name || "");
    }
  } catch {
    // ignore
  }
}
