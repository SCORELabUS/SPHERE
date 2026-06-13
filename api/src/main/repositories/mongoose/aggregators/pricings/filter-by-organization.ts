export const filterByOrganizationAggregator = (organizationId: string) => [
  {
    $match: {
      $expr: {
        $eq: [{ $toString: '$_organizationId' }, organizationId],
      },
    },
  },
];