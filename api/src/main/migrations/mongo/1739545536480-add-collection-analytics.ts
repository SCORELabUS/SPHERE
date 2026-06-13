import { Connection } from 'mongoose';
import PricingCollectionMongoose from '../../repositories/mongoose/models/PricingCollectionMongoose';
import { calculateAnalyticsForPricings } from '../../utils/pricing-collections-utils';

export async function up(connection: Connection): Promise<void> {
  const PricingCollection = connection.models.PricingCollection || connection.model('PricingCollection', PricingCollectionMongoose.schema, 'pricingCollections');

  const collections = await PricingCollection.aggregate([
    {
      $lookup: {
        from: 'pricings',
        let: { localId: { $toString: '$_id' } },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: ['$_collectionId', '$$localId'],
              },
            },
          },
        ],
        as: 'pricings',
      },
    },
  ]);

  for (const collection of collections) {
    if (!collection.pricings || collection.pricings.length === 0) continue;

    const newAnalytics = calculateAnalyticsForPricings(collection.pricings);

    await PricingCollection.updateOne({
      _id: collection._id,
    }, {
      $set: { analytics: newAnalytics },
    });
  }
}

export async function down(connection: Connection): Promise<void> {
  const PricingCollection = connection.models.PricingCollection || connection.model('PricingCollection', PricingCollectionMongoose.schema, 'pricingCollections');

  await PricingCollection.updateMany(
    {},
    {
      $set: {
        analytics: {
          evolutionOfPlans: {
            dates: [],
            values: [],
          },
          evolutionOfAddOns: {
            dates: [],
            values: [],
          },
          evolutionOfFeatures: {
            dates: [],
            values: [],
          },
          evolutionOfConfigurationSpaceSize: {
            dates: [],
            values: [],
          },
        },
      },
    }
  );
}
