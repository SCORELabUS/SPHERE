import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function migrate() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/sphere';
  
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  if (!db) {
    console.error('Failed to get database');
    process.exit(1);
  }

  const collection = db.collection('pricingCollections');

  const docs = await collection.find({}).toArray();
  console.log(`Found ${docs.length} collections`);

  let updated = 0;
  for (const doc of docs) {
    if (!doc.slug && doc.name) {
      const slug = generateSlug(doc.name);
      await collection.updateOne(
        { _id: doc._id },
        { $set: { slug } }
      );
      console.log(`  Updated "${doc.name}" -> slug: "${slug}"`);
      updated++;
    }
  }

  console.log(`Migration complete. Updated ${updated} collections.`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
