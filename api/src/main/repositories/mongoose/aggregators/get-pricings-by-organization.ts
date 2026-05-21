import { PipelineStage } from 'mongoose';
import { OrgRole } from '../../../types/models/Organization';
import { latestPricingsByNameAggregator, refactorRootAggregator } from './pricings/group-pricing-versions';
import { populateCollectionDataAggregator } from './pricings/populateCollectionData';
import { populateOrganizationDataAggregator } from './pricings/populateOrganizationData';
import { refactorOutputAggregator } from './pricings/refactor-output';
import { filtersDataGenerator } from './pricings/filters-data-generator';

export function getPricingsByOrganizationAggregator(
  organizationId: string,
  permissions: { orgRole: OrgRole | null; pricings: string[]; collections: string[] },
  filteringAggregator: PipelineStage[], 
  sortAggregator: PipelineStage[],
) {
  const pipeline: PipelineStage[] = [
    { $sort: { createdAt: -1 } },
    latestPricingsByNameAggregator,
    refactorRootAggregator,
    ...populateCollectionDataAggregator,
    ...populateOrganizationDataAggregator,
    ...filterByOrganizationAggregator(organizationId),
    {
      $set: {
        id: { $toString: '$_id' },
      },
    },
  ];

  if (!permissions.orgRole || (permissions.orgRole !== 'OWNER' && permissions.orgRole !== 'ADMIN')) {
    pipeline.push(considerUserPermissionsAggregator(permissions));
  }

  pipeline.push(...filteringAggregator);
  pipeline.push(...sortAggregator);

  pipeline.push(filtersDataGenerator);
  pipeline.push(refactorOutputAggregator);

  return pipeline;
}

const filterByOrganizationAggregator = (organizationId: string) => [
  {
    $match: {
      $expr: {
        $eq: [{ $toString: '$_organizationId' }, organizationId],
      },
    },
  },
];

const considerUserPermissionsAggregator = (permissions: { orgRole: OrgRole | null; pricings: string[]; collections: string[] }) => {
  return {
      $match: {
        $or: [
          // Condición 1: El ID de la colección está en las colecciones permitidas.
          // Ojo: en tu pipeline haces { $toString: '$collection._id' }, por lo que
          // 'collection.id' es un string. Asumimos que permissions.collections son strings.
          { 'collection.id': { $in: permissions.collections } },

          // Condición 2: El pricing es público
          { private: false },

          // Condición 3: Está explícitamente en el array de pricings permitidos
          { id: { $in: permissions.pricings } },
        ],
      },
    };
} ;