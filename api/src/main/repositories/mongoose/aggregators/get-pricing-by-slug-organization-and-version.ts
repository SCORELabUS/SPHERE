import mongoose from 'mongoose';

export function getPricingBySlugOrganizationAndVersionAggregator(
  pricingSlug: string,
  organizationId: string,
  version?: string
) {
  const versionMatch = version
    ? { $eq: [{ $toLower: '$version' }, { $toLower: version }] }
    : { $literal: true };

  return [
    {
      $match: {
        slug: pricingSlug,
        _organizationId: new mongoose.Types.ObjectId(organizationId),
        $expr: versionMatch,
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
        slug: { $first: '$slug' },
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
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        name: 1,
        slug: 1,
        organization: 1,
        collection: 1,
        versions: { $sortArray: { input: '$versions', sortBy: { createdAt: -1 } } },
      },
    },
  ];
}
