import mongoose from 'mongoose';
import User from '../src/main/repositories/mongoose/models/UserMongoose';
import container from '../src/main/config/container';
import { initMongoose } from '../src/main/config/mongoose';

if (process.env.DATABASE_NAME !== 'sphere_identity_lab' || process.env.MONGO_PORT !== '27018') {
  throw new Error('Identity lab seeding only supports sphere_identity_lab on Mongo 27018');
}
await initMongoose();
try {
  await User.createIndexes();
  for (const username of ['sphere_demo', 'sphere_link']) {
    let user = await User.findOne({ username });
    if (!user) user = await User.create({ username, password: 'Lab-Sphere-Space-2026!', firstName: 'Identity', lastName: 'Lab',
      email: username + '@example.com', emailVerified: true, role: 'USER', settings: { avatar: '' } });
    if (!await container.resolve('organizationRepository').findOne({ name: username, isPersonal: true })) {
      await container.resolve('organizationService').ensurePersonalOrganizationForUser({ id: user.id, username });
    }
  }
  console.log('SPHERE identity laboratory accounts are ready');
} finally { await mongoose.disconnect(); }
