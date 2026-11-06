import { PipelineStage } from "mongoose";
import { VERSION_ORDER } from "../../../../utils/version-order";

export const latestPricingsByNameAggregator: PipelineStage = {
  $group: {
    _id: { $ifNull: ['$pricingId', {
      name: '$name',
      _organizationId: '$_organizationId',
      _collectionId: '$_collectionId',
    }] },
    latestPricing: {
      $first: '$$ROOT',
    },
    // The newest public version (the newest private one only when there is no
    // public version at all), for viewers who cannot see private versions.
    latestPublicPricing: {
      $top: {
        sortBy: { private: 1, ...VERSION_ORDER },
        output: '$$ROOT',
      },
    },
    latestCreatedAt: {
      $max: '$createdAt',
    },
  },
};

export const refactorRootAggregator = {
  $replaceRoot: {
    newRoot: { $mergeObjects: ['$latestPricing', { _latestPublicPricing: '$latestPublicPricing' }] },
  },
};

/**
 * Swaps a pricing for its newest public version unless `canSeePrivate` holds,
 * so a pricing whose newest version is private still lists its public one. A
 * pricing with no public version stays private and is filtered out afterwards.
 */
export const pickVisibleVersionAggregator = (canSeePrivate: unknown) => [
  {
    $replaceRoot: {
      newRoot: {
        $cond: [
          { $or: [{ $ne: ['$private', true] }, canSeePrivate] },
          '$$ROOT',
          {
            $mergeObjects: [
              '$_latestPublicPricing',
              // `_collectionId` too, as the collection lookup may have hidden it.
              { collection: '$collection', organization: '$organization', _collectionId: { $ifNull: ['$_collectionId', null] } },
            ],
          },
        ],
      },
    },
  },
  { $unset: '_latestPublicPricing' },
];