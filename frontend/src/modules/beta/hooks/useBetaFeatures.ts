import { useAuth } from '../../auth/hooks/useAuth';
import type { BetaFeatureKey } from '../config/betaFeatures';

/** Whether the signed-in user turned on beta features in their settings. */
export function useBetaFeatures(): boolean {
  const { authUser } = useAuth();
  return authUser.user?.settings?.betaFeatures === true;
}

/**
 * Whether a registered beta feature is visible to the signed-in user. Every beta
 * feature follows the same switch; the key ties the caller to `BETA_FEATURES`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useBetaFeature(_feature: BetaFeatureKey): boolean {
  return useBetaFeatures();
}
