// Import your schemas here
import { type Connection } from 'mongoose';
import PricingMongoose from '../../repositories/mongoose/models/PricingMongoose';

export async function up(connection: Connection): Promise<void> {
  const Pricing = connection.models.Pricing || connection.model('Pricing', PricingMongoose.schema, 'pricings');

  await Pricing.updateMany({}, [
    {
      $set: {
        createdAt: {
          $ifNull: ['$extractionDate', '$createdAt'],
        },
      },
    },
    {
      $unset: 'extractionDate',
    },
  ]);
}

export async function down(connection: Connection): Promise<void> {
  const Pricing = connection.models.Pricing || connection.model('Pricing', PricingMongoose.schema, 'pricings');

  await Pricing.updateMany({}, [
    {
      $set: {
        extractionDate: {
          $cond: [{ $ifNull: ['$createdAt', false] }, '$createdAt', '$$REMOVE'],
        },
      },
    },
    {
      $unset: 'createdAt',
    },
  ]);
}
