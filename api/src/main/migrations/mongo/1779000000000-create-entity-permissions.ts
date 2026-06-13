import { type Connection } from 'mongoose';
import EntityPermissionMongoose from '../../repositories/mongoose/models/EntityPermissionMongoose';

export async function up(connection: Connection): Promise<void> {
  const EntityPermission = connection.models.EntityPermission ||
    connection.model('EntityPermission', EntityPermissionMongoose.schema, 'entityPermissions');

  // Create indexes for efficient querying
  await EntityPermission.collection.createIndex(
    { _userId: 1, _organizationId: 1, entityType: 1, entityId: 1 },
    { unique: true }
  );
  await EntityPermission.collection.createIndex({ _organizationId: 1 });
  await EntityPermission.collection.createIndex({ _userId: 1, entityType: 1 });
}

export async function down(connection: Connection): Promise<void> {
  const EntityPermission = connection.models.EntityPermission ||
    connection.model('EntityPermission', EntityPermissionMongoose.schema, 'entityPermissions');

  await EntityPermission.collection.dropIndexes();
}
