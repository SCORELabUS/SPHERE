import mongoose from 'mongoose';
import { up as assignPricingIdentities } from '../../../migrations/mongo/2026092005000-pricing-identities';
import { Seeder } from 'mongo-seeding';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMongoDBConnectionURI } from '../../../config/mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  database: getMongoDBConnectionURI(),
  // The local MongoDB instance is shared with other projects. Seeding is
  // scoped to this connection's DATABASE_NAME and must never drop databases
  // owned by another application (or erase the shared database on startup).
  dropDatabase: false
};

const seeder = new Seeder(config);

const collections = seeder.readCollectionsFromPath(path.resolve(__dirname));

export const seedDatabase = async () => {
  try {
    if (process.env.SEED_RESET_DATABASE === 'true' && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await seeder.import(collections);
    await assignPricingIdentities(mongoose.connection);
    console.log('==== Mongo seeding successfull ====');
  } catch (err) {
    console.error(`Seeding error: ${err}`);
  }
};
