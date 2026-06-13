// Import your schemas here
import { type Connection } from 'mongoose';
import UserMongoose from '../../repositories/mongoose/models/UserMongoose';

export async function up(connection: Connection): Promise<void> {
  const User = connection.models.User || connection.model('User', UserMongoose.schema, 'users');

  await User.updateMany(
    { userType: { $exists: true }, role: { $exists: false } },
    [
      {
        $set: {
          role: { $toUpper: '$userType' },
        },
      },
      {
        $unset: 'userType',
      },
    ]
  );
}

export async function down(connection: Connection): Promise<void> {
  const User = connection.models.User || connection.model('User', UserMongoose.schema, 'users');

  await User.updateMany(
    { role: { $exists: true }, userType: { $exists: false } },
    [
      {
        $set: {
          userType: { $toLower: '$role' },
        },
      },
      {
        $unset: 'role',
      },
    ]
  );
}
