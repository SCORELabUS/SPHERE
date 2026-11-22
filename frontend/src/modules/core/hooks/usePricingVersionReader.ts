import { useCallback } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';
import { usePricingsApi } from '../../pricing/api/pricingsApi';
import { readVersionYaml } from '../../pricing/utils/version-yaml';
import type { PullRequestVersionRef } from '../../pricing/types/pull-requests';

/** A pricing whose versions are not loaded on the page: where it lives and, when known, its id. */
export interface PricingVersionSource {
  organizationId: string;
  slug: string;
  collectionSlug?: string | null;
  pricingId?: string;
}

/**
 * Reads the YAML of a version of a pricing the page has not loaded (the
 * pricing a fork proposes to, or the one the editor proposes to), as the
 * caller may read it. A slug that now names another pricing is refused.
 */
export function usePricingVersionReader() {
  const { getPricingBySlug } = usePricingsApi();
  const { authUser } = useAuth();

  return useCallback(
    async (pricing: PricingVersionSource, target: PullRequestVersionRef): Promise<string> => {
      let data: { pricingId?: string; versions?: { id: string; yaml: string }[] };
      try {
        data = await getPricingBySlug(pricing.slug, pricing.organizationId, pricing.collectionSlug ?? null);
      } catch {
        throw new Error('the pricing could not be read.');
      }
      if (pricing.pricingId && data.pricingId !== pricing.pricingId) throw new Error('the pricing could not be read.');
      const version = (data.versions ?? []).find(item => item.id === target.id);
      if (!version) throw new Error('it is not one of the versions you can read.');
      return readVersionYaml(version.yaml, authUser.token);
    },
    [getPricingBySlug, authUser.token]
  );
}
