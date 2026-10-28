import mongoose from 'mongoose';

// Index used by the /static guard to find the versions that reference a file
// (see YAML_PATH_COLLATION in PricingMongoose). Mongoose also creates it on
// startup when autoIndex is on; the migration covers deployments without it.
export async function up(db: mongoose.Connection) {
  await db.collection('pricings').createIndex(
    { yaml: 1 },
    { name: 'yaml_1_ci', collation: { locale: 'en', strength: 2 } }
  );
}

export async function down(db: mongoose.Connection) {
  await db.collection('pricings').dropIndex('yaml_1_ci').catch(() => undefined);
}
