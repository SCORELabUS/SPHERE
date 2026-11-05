import mongoose from 'mongoose';

// Index used by the version graph to find the pricings forked from one (see
// PricingRepository.findForkPricingIds). Mongoose also creates it on startup
// when autoIndex is on; the migration covers deployments without it.
export async function up(db: mongoose.Connection) {
  await db.collection('pricings').createIndex(
    { 'forkedFrom.pricingId': 1 },
    { name: 'forkedFrom_pricingId_1', partialFilterExpression: { 'forkedFrom.pricingId': { $exists: true } } }
  );
}

export async function down(db: mongoose.Connection) {
  await db.collection('pricings').dropIndex('forkedFrom_pricingId_1').catch(() => undefined);
}
