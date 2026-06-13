import mongoose from 'mongoose';
import {seedDatabase} from '../src/main/database/seeders/mongo/seeder';
import {initMongoose} from '../src/main/config/mongoose';

await initMongoose();
await seedDatabase();
await mongoose.disconnect();