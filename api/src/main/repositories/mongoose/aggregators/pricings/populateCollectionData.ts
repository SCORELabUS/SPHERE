export const populateCollectionDataAggregator = [
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
      collection: {
        id: { $toString: '$collection._id' },
        name: '$collection.name',
        slug: '$collection.slug',
      },
    },
  },
];