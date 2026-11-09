import mongoose from 'mongoose';

// Versions loaded from the seed data keep `createdAt` as text. In descending order
// MongoDB sorts every date ahead of every string, so a version stored with a date
// would go first whatever its day. Text MongoDB can read becomes that instant;
// anything else is left as it is, to be looked at by hand.
export async function up(db: mongoose.Connection) {
  const pricings = db.collection('pricings');
  await pricings.updateMany(
    { createdAt: { $type: 'string' } },
    [{ $set: { createdAt: { $convert: { input: '$createdAt', to: 'date', onError: '$createdAt' } } } }]
  );
  const unreadable = await pricings.countDocuments({ createdAt: { $not: { $type: 'date' } } });
  if (unreadable > 0) {
    console.warn(`${unreadable} pricing version(s) keep a createdAt that is not a date; fix them by hand.`);
  }
}

export async function down() {
  // Nothing to undo: the schema stores dates, and versions stored as dates from the
  // start cannot be told apart from those this turned into dates.
}
