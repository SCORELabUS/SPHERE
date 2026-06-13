import mongoose from 'mongoose';

export function getPricingByNameAndOrganizationAggregator(pricingName: string, organizationId: string) {
  return [
    {
      $match: {
        name: { $regex: `^${pricingName}$`, $options: 'i' },
        _organizationId: new mongoose.Types.ObjectId(organizationId),
      },
    },
    {
      $lookup: {
        from: 'pricingCollections',
        let: {
          localCollectionId: {
            $convert: {
              input: '$_collectionId',
              to: 'objectId',
              onError: null,
              onNull: null,
            },
          },
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: ['$_id', '$$localCollectionId'],
              },
            },
          },
          {
            $project: {
              name: 1,
              slug: 1,
            },
          },
        ],
        as: 'collection',
      },
    },
    {
      $lookup: {
        from: 'organizations',
        localField: '_organizationId',
        foreignField: '_id',
        as: 'organization',
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              displayName: 1,
              avatar: 1,
              isPersonal: 1,
            },
          },
        ],
      },
    },
    { $unwind: { path: '$collection', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$organization', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { name: '$name', organizationId: { $toString: '$organization._id' }, collectionSlug: '$collection.slug' },
        name: { $first: '$name' },
        collection: {
          $first: {
            id: { $toString: '$collection._id' },
            name: '$collection.name',
            slug: '$collection.slug',
          },
        },
        versions: {
          $push: {
            id: { $toString: '$_id' },
            _collectionId: {
              $cond: [
                { $ifNull: ['$_collectionId', false] },
                { $toString: '$_collectionId' },
                null,
              ],
            },
            version: '$version',
            private: '$private',
            collectionName: { $ifNull: ['$collection.name', null] },
            createdAt: '$createdAt',
            url: '$url',
            yaml: '$yaml',
            analytics: '$analytics',
            organization: {
              id: { $toString: '$organization._id' },
              name: '$organization.name',
              displayName: '$organization.displayName',
              avatar: '$organization.avatar',
              isPersonal: '$organization.isPersonal',
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        name: 1,
        organization: 1,
        collection: 1,
        versions: { $sortArray: { input: '$versions', sortBy: { createdAt: -1 } } },
      },
    },
  ];
}
