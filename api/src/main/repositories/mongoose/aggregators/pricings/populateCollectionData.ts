import { PrivateCollectionAccess } from '../../../../types/policies';

/**
 * Adds the pricing's collection as `{ id, name, slug }`. A pricing in a
 * private collection the viewer cannot read is omitted from the listing.
 */
export const populateCollectionDataAggregator = (visibility: PrivateCollectionAccess) => {
  const visible =
    visibility === 'all'
      ? true
      : {
          $or: [
            { $ne: [{ $ifNull: ['$collection.private', false] }, true] },
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
    // A collection is a parent access boundary, not just hidden metadata.
    { $match: { $expr: visible } } as any,
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
