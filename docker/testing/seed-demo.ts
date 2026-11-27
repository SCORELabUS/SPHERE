// Loads SPHERE's demo dataset (users, organizations and example pricings from
// api/src/main/database/seeders/mongo) into the testing database, only when it
// is empty, so restarting the stack keeps whatever the user changed.
// Run by seed-demo.sh before the API starts; not part of the application.
import mongoose from 'mongoose';
import { initMongoose } from '../src/main/config/mongoose';
import { seedDatabase } from '../src/main/database/seeders/mongo/seeder';

await initMongoose();
const users = await mongoose.connection.db!.collection('users').countDocuments();
if (users > 0) {
  console.log('Demo data: the database already has users, nothing to load');
} else {
  console.log('Demo data: loading users, organizations and example pricings...');
  await seedDatabase();
}
await mongoose.disconnect();
