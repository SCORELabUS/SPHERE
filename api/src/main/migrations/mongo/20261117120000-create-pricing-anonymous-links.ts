import { type Connection } from 'mongoose';
import PricingAnonymousLinkMongoose from '../../repositories/mongoose/models/PricingAnonymousLinkMongoose';

export async function up(connection: Connection): Promise<void> {
  const PricingAnonymousLink = connection.models.PricingAnonymousLink ||
    connection.model('PricingAnonymousLink', PricingAnonymousLinkMongoose.schema, 'pricingAnonymousLinks');

  await PricingAnonymousLink.collection.createIndex({ token: 1 }, { unique: true });
  await PricingAnonymousLink.collection.createIndex({ pricingId: 1, createdAt: -1 });
  await PricingAnonymousLink.collection.createIndex({ versionId: 1 });
}

export async function down(connection: Connection): Promise<void> {
  await connection.db?.collection('pricingAnonymousLinks').drop().catch(() => undefined);
}
