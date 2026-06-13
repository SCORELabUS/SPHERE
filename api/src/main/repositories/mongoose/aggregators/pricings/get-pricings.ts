import { PipelineStage } from "mongoose";
import { OrgUserPermissionsContext } from "../../../../types/policies";
import { latestPricingsByNameAggregator, refactorRootAggregator } from "./group-pricing-versions";
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
      {
        $set: {
          id: { $toString: '$_id' },
        },
      },
    ];
    
    pipeline.push(...filteringAggregator);
    
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