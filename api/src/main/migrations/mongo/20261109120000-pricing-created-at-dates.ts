import mongoose from 'mongoose';

// Versions loaded from the seed data keep `createdAt` as text. MongoDB sorts every
// date ahead of every string, so a version stored with a date would go first
// whatever its day. Text MongoDB can read becomes that instant; anything else is
// left as it is, to be looked at by hand.
export async function up(db: mongoose.Connection) {
  await db.collection('pricings').updateMany(
    { createdAt: { $type: 'string' } },
    [{ $set: { createdAt: { $convert: { input: '$createdAt', to: 'date', onError: '$createdAt' } } } }]
  );
}

export async function down() {
  // Nothing to undo: the schema stores dates, and versions stored as dates from the
  // start cannot be told apart from those this turned into dates.
}
