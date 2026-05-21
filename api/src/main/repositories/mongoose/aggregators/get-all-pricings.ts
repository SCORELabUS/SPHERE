import { filtersDataGenerator } from "./pricings/filters-data-generator";
import { latestPricingsByNameAggregator, refactorRootAggregator } from "./pricings/group-pricing-versions";
import { populateCollectionDataAggregator } from "./pricings/populateCollectionData";
import { populateOrganizationDataAggregator } from "./pricings/populateOrganizationData";
import { refactorOutputAggregator } from "./pricings/refactor-output";

export function getAllPricingsAggregator(filteringAggregators: any, sortAggregator: any) {
  return [
    { $sort: { createdAt: -1 } },
    latestPricingsByNameAggregator,
    refactorRootAggregator,
    ...populateCollectionDataAggregator,
    ...populateOrganizationDataAggregator,
    ...filteringAggregators,
    filtersDataGenerator,
    refactorOutputAggregator,
    ...sortAggregator,
  ];
};