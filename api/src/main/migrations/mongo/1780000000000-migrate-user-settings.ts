import { type Connection } from 'mongoose';
import UserMongoose from '../../repositories/mongoose/models/UserMongoose';

export async function up(connection: Connection): Promise<void> {
  const User = connection.models.User || connection.model('User', UserMongoose.schema, 'users');

  // Migrate old flat fields into the nested settings subdocument
  await User.updateMany(
    { $or: [{ phone: { $exists: true } }, { avatar: { $exists: true } }, { profile: { $exists: true } }, { socialLinks: { $exists: true } }, { notificationPrefs: { $exists: true } }] },
    [
      {
        $set: {
          settings: {
            $mergeObjects: [
              '$settings',
              {
                phone: '$phone',
                avatar: '$avatar',
                avatarBgColor: '$avatarBgColor',
                avatarFgColor: '$avatarFgColor',
                profile: '$profile',
                socialLinks: '$socialLinks',
                notificationPrefs: '$notificationPrefs',
              },
            ],
          },
        },
      },
      {
        $unset: ['phone', 'avatar', 'avatarBgColor', 'avatarFgColor', 'profile', 'socialLinks', 'notificationPrefs'],
      },
    ]
  );

  // Ensure all users have a settings object (even if empty)
  await User.updateMany(
    { settings: { $exists: false } },
    { $set: { settings: {} } }
  );

  // Set default avatar for users without one
  await User.updateMany(
    { 'settings.avatar': { $exists: false } },
    { $set: { 'settings.avatar': "" } }
  );
}

export async function down(connection: Connection): Promise<void> {
  const User = connection.models.User || connection.model('User', UserMongoose.schema, 'users');

  // Move settings fields back to top level
  await User.updateMany(
    { settings: { $exists: true } },
    [
      {
        $set: {
          phone: '$settings.phone',
          avatar: '$settings.avatar',
          avatarBgColor: '$settings.avatarBgColor',
          avatarFgColor: '$settings.avatarFgColor',
          profile: '$settings.profile',
          socialLinks: '$settings.socialLinks',
          notificationPrefs: '$settings.notificationPrefs',
        },
      },
      {
        $unset: 'settings',
      },
    ]
  );
}
