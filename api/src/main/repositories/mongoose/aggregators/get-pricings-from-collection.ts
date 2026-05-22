import { getPricingsAggregator } from './pricings/get-pricings';

export function getAllPricingsFromCollection() {
  return [
    lookupForPricingsAggregator,
    {
      $set: {
        data: {
          $arrayElemAt: ['$pricings', 0],
        },
      },
    },
    {
      $unset: 'pricings',
    },
  ];
}

const lookupForPricingsAggregator = {
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

      ...getPricingsAggregator(undefined, {orgRole: null, pricings: [], collections: [], isGlobalAdmin: false, adminOrgIds: []}, []),
    ] as any,
    as: 'pricings',
  },
};
