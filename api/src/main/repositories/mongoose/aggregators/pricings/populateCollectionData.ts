import { PrivateCollectionAccess } from '../../../../types/policies';

/**
 * Adds the pricing's collection as `{ id, name, slug }`. A private collection
 * the viewer may not see is left out, `_collectionId` included, so the pricing
 * reads, filters and sorts exactly like one in no collection.
 */
export const populateCollectionDataAggregator = (visibility: PrivateCollectionAccess) => {
  const visible =
    visibility === 'all'
      ? true
      : {
          $or: [
            { $ne: ['$collection.private', true] },
            { $in: [{ $toString: '$collection._id' }, visibility] },
          ],
        };

  return [
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
        ],
        as: 'collection',
      },
    },
    {
      $unwind: {
        path: '$collection',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $set: {
        _collectionId: { $cond: [visible, '$_collectionId', null] },
        collection: {
          $cond: [
            visible,
            {
              id: { $toString: '$collection._id' },
              name: '$collection.name',
              slug: '$collection.slug',
            },
            { id: null },
          ],
        },
      },
    },
  ];
};
