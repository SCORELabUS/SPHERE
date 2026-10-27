import { OrgUserPermissionsContext } from '../../../types/policies';
import { getPricingsAggregator } from './pricings/get-pricings';

export function getAllPricingsFromCollection(permissions?: OrgUserPermissionsContext) {
  const pricingPermissions = permissions
    ? { orgRole: permissions.orgRole, pricings: permissions.pricings ?? [], collections: permissions.collections ?? [], isGlobalAdmin: permissions.isGlobalAdmin, adminOrgIds: permissions.adminOrgIds ?? [] }
    : { orgRole: null, pricings: [], collections: [], isGlobalAdmin: false, adminOrgIds: [] };

  return [
    {
      $lookup: {
        from: 'pricings',
        let: { localId: { $toString: '$_id' } },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: [{ $toString: '$_collectionId' }, '$$localId'],
              },
            },
          },
          // The collection itself is the subject here, and its own visibility is checked by the caller.
          ...getPricingsAggregator(undefined, permissions ? pricingPermissions : undefined, [], [], 'all'),
        ] as any,
        as: 'pricings',
      },
    },
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
