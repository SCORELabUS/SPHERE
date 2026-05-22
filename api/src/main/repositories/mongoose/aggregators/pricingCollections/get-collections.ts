import { PipelineStage } from 'mongoose';
import { OrgUserPermissionsContext } from '../../../../types/policies';
import { refactorCollectionOutput } from './refactor-output';
import { addNumberOfPricingsAggregator } from './add-number-of-pricings';
import { addOrganizationToCollectionAggregator } from './add-organization-to-collection';
import { considerUserCollectionPermissionsAggregator } from './apply-user-permissions';

export function getCollectionsAggregator(
  organizationId?: string,
  permissions?: OrgUserPermissionsContext,
  filteringAggregator: PipelineStage[] = [],
  sortAggregator: PipelineStage[] = []
) {
  const pipeline: PipelineStage[] = [];

  if (!permissions) {
    pipeline.push({ $match: { private: false } });
  }

  if (organizationId) {
    pipeline.push({
      $match: {
        organizationId: organizationId,
      },
    });
  }

  pipeline.push(...addNumberOfPricingsAggregator());
  pipeline.push(...addOrganizationToCollectionAggregator());
  pipeline.push(...filteringAggregator);

  if (
    permissions &&
    !permissions.isGlobalAdmin &&
    (!permissions.orgRole || (permissions.orgRole !== 'OWNER' && permissions.orgRole !== 'ADMIN'))
  ) {
    pipeline.push(considerUserCollectionPermissionsAggregator(permissions));
  }

  pipeline.push({ $sort: { name: 1 } });
  pipeline.push(...sortAggregator);
  pipeline.push(refactorCollectionOutput);

  return pipeline;
}
