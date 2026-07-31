import { useEffect, useState } from "react";
import { PricingVersionsResult } from "../sphere";
import { usePricingsApi } from "../../pricing/api/pricingsApi";

export function usePricingVersions(
  organizationId: string,
  slug: string,
  collectionSlug?: string | null
) {
  const [versions, setVersions] = useState<PricingVersionsResult | undefined>(
    undefined
  );
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<Error | undefined>(undefined);
  const { getPricingBySlug } = usePricingsApi()

  useEffect(() => {
    let ignore = false;

    const makeRequest = async () => {
      try {
        setLoading(true);
        setError(undefined);
        setVersions(undefined);

        const data = await getPricingBySlug(slug, organizationId, collectionSlug ?? null);
        if (ignore) return;

        if ("error" in data) {
          setError(Error(data.error));
        } else {
          setVersions(data);
        }
      } catch (error) {
        if (ignore) return;
        setError(error as Error);
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    makeRequest();

    return () => {
      ignore = true;
    };
  }, [collectionSlug, getPricingBySlug, organizationId, slug]);

  return { loading, error, versions };
}
