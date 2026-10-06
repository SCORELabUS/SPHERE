import { PipelineStage } from "mongoose";
import { OrgUserPermissionsContext } from "../../../../types/policies";
import { latestPricingsByNameAggregator, pickVisibleVersionAggregator, refactorRootAggregator } from "./group-pricing-versions";
import { populateCollectionDataAggregator } from "./populateCollectionData";
import { populateOrganizationDataAggregator } from "./populateOrganizationData";
import { filterByOrganizationAggregator } from "./filter-by-organization";
import { considerUserPermissionsAggregator } from "./filter-by-user-permissions";
import { filtersDataGenerator } from "./filters-data-generator";
import { refactorOutputAggregator } from "./refactor-output";

export function getPricingsAggregator(
  organizationId?: string,
  permissions?: OrgUserPermissionsContext,
  filteringAggregator: PipelineStage[] = [],
  sortAggregator: PipelineStage[] = [],
){
  const pipeline: PipelineStage[] = [
      { $sort: { createdAt: -1 } },
      latestPricingsByNameAggregator,
      refactorRootAggregator,
      ...populateCollectionDataAggregator,
      ...populateOrganizationDataAggregator,
      ...(organizationId ? filterByOrganizationAggregator(organizationId) : [{ $match: {} }]),
      ...pickVisibleVersionAggregator(canSeePrivateVersions(permissions)),
      {
        $set: {
          id: { $toString: '$_id' },
        },
      },
    ];
    
    pipeline.push(...filteringAggregator);
    
    // The version chosen above is public unless the viewer may see private ones,
    // so these only drop pricings that have no public version at all.
    if (!permissions){
      pipeline.push({ $match: { private: false } });
    }else if (!permissions.isGlobalAdmin && (!permissions.orgRole || (permissions.orgRole !== 'OWNER' && permissions.orgRole !== 'ADMIN'))) {
      pipeline.push(considerUserPermissionsAggregator(permissions));
    }
  
    pipeline.push(filtersDataGenerator);
    pipeline.push(refactorOutputAggregator);
    pipeline.push(...sortAggregator);
  
    return pipeline;
}

/**
 * Whether the viewer may see a pricing's private versions: the same grounds as
 * considerUserPermissionsAggregator, minus the pricing being public.
 */
function canSeePrivateVersions(permissions?: OrgUserPermissionsContext): unknown {
  if (!permissions) return false;
  if (permissions.isGlobalAdmin || permissions.orgRole === 'OWNER' || permissions.orgRole === 'ADMIN') return true;
  return {
    $or: [
      { $in: [{ $toString: '$_organizationId' }, permissions.adminOrgIds] },
      { $in: [{ $ifNull: ['$collection.slug', null] }, permissions.collections] },
      { $in: ['$slug', permissions.pricings] },
    ],
  };
}
