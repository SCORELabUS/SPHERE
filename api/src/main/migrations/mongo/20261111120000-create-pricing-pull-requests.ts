import { type Connection } from 'mongoose';
import PricingPullRequestMongoose from '../../repositories/mongoose/models/PricingPullRequestMongoose';

export async function up(connection: Connection): Promise<void> {
  const PricingPullRequest = connection.models.PricingPullRequest ||
    connection.model('PricingPullRequest', PricingPullRequestMongoose.schema, 'pricingPullRequests');

  await PricingPullRequest.collection.createIndex({ pricingId: 1, number: 1 }, { unique: true });
  await PricingPullRequest.collection.createIndex({ pricingId: 1, status: 1, updatedAt: -1 });
  await PricingPullRequest.collection.createIndex({ authorId: 1, createdAt: -1 });
  await PricingPullRequest.collection.createIndex(
    { pricingId: 1, 'origin.pricingId': 1 },
    { unique: true, partialFilterExpression: { status: 'open', 'origin.pricingId': { $exists: true } } }
  );
}

export async function down(connection: Connection): Promise<void> {
  await connection.db?.collection('pricingPullRequests').drop().catch(() => undefined);
}
