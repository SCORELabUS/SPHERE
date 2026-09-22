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
      ...populateCollectionDataAggregator,
      ...populateOrganizationDataAggregator,
      ...(organizationId ? filterByOrganizationAggregator(organizationId) : [{ $match: {} }]),
    ];

    // Visibility is a property of a version, not of the pricing as a whole.
    // Apply access checks before selecting the representative (latest) version so
    // a newer private version cannot hide an older public version from listings.
    if (!permissions){
      pipeline.push({ $match: { private: false } });
    }else if (!permissions.isGlobalAdmin && (!permissions.orgRole || (permissions.orgRole !== 'OWNER' && permissions.orgRole !== 'ADMIN'))) {
      pipeline.push(considerUserPermissionsAggregator(permissions));
    }

    pipeline.push(
      latestPricingsByNameAggregator,
      refactorRootAggregator,
      {
        $set: {
          id: { $toString: '$_id' },
        },
      },
      ...filteringAggregator,
    );
  
    pipeline.push(filtersDataGenerator);
    pipeline.push(refactorOutputAggregator);
    pipeline.push(...sortAggregator);
  
    return pipeline;
}
