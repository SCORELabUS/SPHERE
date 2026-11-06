import mongoose from 'mongoose';

// Versions stored before `addedAt` existed get the instant their `_id` was made,
// which is when they were inserted (to the second). New versions get it from
// `PricingRepository.create`.
export async function up(db: mongoose.Connection) {
  await db.collection('pricings').updateMany(
    { addedAt: { $exists: false } },
    [{ $set: { addedAt: { $toDate: '$_id' } } }]
  );
}

export async function down(db: mongoose.Connection) {
  await db.collection('pricings').updateMany({}, { $unset: { addedAt: '' } });
}
