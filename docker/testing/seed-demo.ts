// Loads SPHERE's demo dataset (users, organizations and example pricings from
// api/src/main/database/seeders/mongo) into the testing database, only when it
// is empty, so restarting the stack keeps whatever the user changed.
// Run by seed-demo.sh before the API starts; not part of the application.
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { initMongoose } from '../src/main/config/mongoose';
import { seedDatabase } from '../src/main/database/seeders/mongo/seeder';

const DEMO_PASSWORD = 'faked';

await initMongoose();
const users = await mongoose.connection.db!.collection('users').countDocuments();
if (users > 0) {
  console.log('Demo data: the database already has users, nothing to load');
} else {
  console.log('Demo data: loading users, organizations and example pricings...');
  await seedDatabase();
  // The seeded users keep the development password; the demo accounts get
  // the documented one instead.
  const result = await mongoose.connection.db!.collection('users').updateMany(
    {},
    { $set: { password: await bcrypt.hash(DEMO_PASSWORD, 5) } }
  );
  if (result.matchedCount === 0) {
    console.error('Demo data: no users were loaded, check the seeding errors above');
    process.exit(1);
  }
  console.log(`Demo data: ${result.matchedCount} users ready, password "${DEMO_PASSWORD}"`);
}
await mongoose.disconnect();
