import mongoose from 'mongoose';

export async function up(db: mongoose.Connection) {
  // Add CREATE field to all existing entityPermission documents (defaults to false)
  await db
    .collection('entityPermissions')
    .updateMany(
      { 'permissions.CREATE': { $exists: false } },
      { $set: { 'permissions.CREATE': false } }
    );

  // Drop the old compound unique index (find by key pattern)
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

  // Recreate the compound unique index.
  // MongoDB unique indexes treat null as a distinct value, so:
  // - Two entity-scoped records with the same entityId → blocked (correct)
  // - Two org-scoped records with entityId=null per user/org/type → blocked (correct, one per user/org/type)
  // - One entity-scoped + one org-scoped (same user/org/type) → allowed (null !== ObjectId)
  await db
    .collection('entityPermissions')
    .createIndex({ _userId: 1, _organizationId: 1, entityType: 1, entityId: 1 }, { unique: true });
}

export async function down(db: mongoose.Connection) {
  // Remove the new index
  try {
    const indexes = await db.collection('entityPermissions').indexes();
    const idx = indexes.find(
      (i: any) =>
        i.unique &&
        i.key._userId === 1 &&
        i.key._organizationId === 1 &&
        i.key.entityType === 1 &&
        i.key.entityId === 1
    );
    if (idx) {
      await db.collection('entityPermissions').dropIndex(idx.name || "");
    }
  } catch {
    // ignore
  }

  // Recreate original index (same structure, just removing CREATE field)
  await db
    .collection('entityPermissions')
    .createIndex({ _userId: 1, _organizationId: 1, entityType: 1, entityId: 1 }, { unique: true });

  // Remove the CREATE field
  await db.collection('entityPermissions').updateMany({}, { $unset: { 'permissions.CREATE': '' } });
}
