export const populateOrganizationDataAggregator = [
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
  {
    $unwind: '$organization',
  },
  {
    $set: {
      'organization.id': { $toString: '$organization._id' },
    },
  },
  {
    $unset: 'organization._id',
  },
];