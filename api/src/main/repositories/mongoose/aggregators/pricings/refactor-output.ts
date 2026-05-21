export const refactorOutputAggregator = {
  $project: {
    pricings: '$pricings',
    minPrice: {
      $arrayElemAt: ['$minPrice', 0],
    },
    maxPrice: {
      $arrayElemAt: ['$maxPrice', 0],
    },
    configurationSpaceSize: {
      $arrayElemAt: ['$configurationSpaceSize', 0],
    },
  },
};