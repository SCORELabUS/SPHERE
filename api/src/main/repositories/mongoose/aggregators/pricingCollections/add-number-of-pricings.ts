import { OrgUserPermissionsContext } from '../../../../types/policies';
import { getAllPricingsFromCollection } from '../get-pricings-from-collection';

export function addNumberOfPricingsAggregator(permissions?: OrgUserPermissionsContext) {
  return [
    ...getAllPricingsFromCollection(permissions),
    {
      $addFields: {
        numberOfPricings: { $size: '$data.pricings' },
      },
    },
  ];
}
