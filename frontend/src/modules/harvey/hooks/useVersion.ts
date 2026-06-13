import { useEffect, useState } from "react";
import { PricingVersionsResult } from "../sphere";
import { usePricingsApi } from "../../pricing/api/pricingsApi";

export function usePricingVersions(
  owner: string,
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
    const makeRequest = async () => {
      try {
        setLoading(true)
        const data = await getPricingBySlug(slug, owner, collectionSlug ?? null);
        if ("error" in data) {
          setError(Error(data.error));
        } else {
          setVersions(data);
        }
      } catch (error) {
        setError(error as Error);
      } finally {
        setLoading(false)
      }
    };
    makeRequest();
  }, []);

  return { loading, error, versions };
}
