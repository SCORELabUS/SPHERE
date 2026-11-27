import mongoose from 'mongoose';

/** Preserve the historical public visibility of existing organizations. */
export async function up(db: mongoose.Connection) {
  await db.collection('organizations').updateMany({ visibility: { $exists: false } }, { $set: { visibility: 'public' } });
}

// Do not remove visibility values chosen after the migration.
export async function down(_db: mongoose.Connection) {}
