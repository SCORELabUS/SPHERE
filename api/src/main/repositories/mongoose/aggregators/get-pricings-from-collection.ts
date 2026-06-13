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
                $eq: ['$_collectionId', '$$localId'],
              },
            },
          },
          ...getPricingsAggregator(undefined, permissions ? pricingPermissions : undefined, []),
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
