import { PipelineStage } from 'mongoose';

export const refactorCollectionOutput: PipelineStage = {
  $project: {
    id: { $toString: '$_id' },
    _id: 0,
    organization: {
      name: 1,
      displayName: 1,
      avatar: 1,
      id: { $toString: '$organization.id' },
    },
    name: 1,
    slug: 1,
    numberOfPricings: 1,
  },
};