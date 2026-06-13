import { PipelineStage } from "mongoose";

export const latestPricingsByNameAggregator: PipelineStage = {
  $group: {
    _id: {
      name: '$name',
      _organizationId: '$_organizationId',
      _collectionId: '$_collectionId',
    },
    latestPricing: {
      $first: '$$ROOT',
    },
    latestCreatedAt: {
      $max: '$createdAt',
    },
  },
};

export const refactorRootAggregator = {
  $replaceRoot: {
    newRoot: '$latestPricing',
  },
};