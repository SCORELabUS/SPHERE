import { Policy } from '../../types/policies';
import { organizationPolicies } from './organizationPolicies';
import { entityPolicies } from './entityPolicies';

/**
 * Registry of all policies.
 * Policies are evaluated in order. First applicable policy wins.
 */
export const allPolicies: Policy[] = [
  ...organizationPolicies,
  ...entityPolicies,
];

export { organizationPolicies } from './organizationPolicies';
export { entityPolicies } from './entityPolicies';
