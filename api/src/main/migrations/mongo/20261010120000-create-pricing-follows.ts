import { type Connection } from 'mongoose';
import PricingFollowMongoose from '../../repositories/mongoose/models/PricingFollowMongoose';

export async function up(connection: Connection): Promise<void> {
  const PricingFollow = connection.models.PricingFollow ||
    connection.model('PricingFollow', PricingFollowMongoose.schema, 'pricingFollows');

  await PricingFollow.collection.createIndex({ _userId: 1, pricingId: 1 }, { unique: true });
  await PricingFollow.collection.createIndex({ pricingId: 1 });
}

export async function down(connection: Connection): Promise<void> {
  await connection.db?.collection('pricingFollows').drop().catch(() => undefined);
}
