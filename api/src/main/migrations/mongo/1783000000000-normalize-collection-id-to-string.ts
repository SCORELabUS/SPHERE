import mongoose from 'mongoose';

export async function up(db: mongoose.Connection) {
  // Convert all ObjectId _collectionId values to String in the pricings collection.
  // The Mongoose schema defines _collectionId as String, but some code paths
  // (e.g., addPricingToCollection, create) were storing it as ObjectId.
  // This migration normalizes all values to String for consistent $lookup comparisons.

  const pricingsWithObjectIdCollectionId = await db
    .collection('pricings')
    .find({ _collectionId: { $type: 'objectId' } })
    .toArray();

  if (pricingsWithObjectIdCollectionId.length === 0) {
    return;
  }

  const bulkOps = pricingsWithObjectIdCollectionId.map((pricing: any) => ({
    updateOne: {
      filter: { _id: pricing._id },
      update: { $set: { _collectionId: pricing._collectionId.toString() } },
    },
  }));

  await db.collection('pricings').bulkWrite(bulkOps);
}

export async function down(db: mongoose.Connection) {
  // No-op: downgrading would require knowing which strings were ObjectIds,
  // which is not reliably reversible.
}
