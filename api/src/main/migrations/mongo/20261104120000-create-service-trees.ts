import { type Connection } from 'mongoose';
import ServiceTreeMongoose from '../../repositories/mongoose/models/ServiceTreeMongoose';

export async function up(connection: Connection): Promise<void> {
  const ServiceTree = connection.models.ServiceTree ||
    connection.model('ServiceTree', ServiceTreeMongoose.schema, 'serviceTrees');

  await ServiceTree.collection.createIndex({ _organizationId: 1 }, { unique: true });
}

export async function down(connection: Connection): Promise<void> {
  await connection.db?.collection('serviceTrees').drop().catch(() => undefined);
}
