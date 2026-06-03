import { useEffect, useState } from "react";
import { usePricingsApi } from "../../pricing/api/pricingsApi";

export interface PricingSearchResult {
  total: number;
  pricings: PricingSearchResultItem[];
}

export interface PricingSearchResultItem {
  name: string;
  slug: string;
  owner: string;
  version: string;
  createdAt: string;
  currency: string;
  analytycs: {
    numberOfFeatures: number;
    numberOfPlans: number;
    numberOfAddOns: number;
    configurationSpaceSize: number;
    minSubscriptionPrice: number;
    maxSubscriptionPrice: number;
  };
  collection: { id: string; name: string; slug: string } | null;
}

export interface PricingEntry {
  name: string;
  slug: string;
  organization: { id: string; name: string; displayName: string; avatar: string };
  version: string;
  collection: { id: string; name: string; slug: string } | null;
  createdAt: string;
  currency: string;
  analytics: {
    configurationSpaceSize: number;
    minSubscriptionPrice: number;
    maxSubscriptionPrice: number;
  };
}

export function usePricings(
  search: string,
  offset: number = 0,
  limit: number = 10
) {
  const [pricings, setPricings] = useState<PricingSearchResult>(
    {pricings: [], total: 0}
  );
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | undefined>(undefined);
  const { getPricings} = usePricingsApi()

  useEffect(() => {
    const makeRequest = async () => {
      try {
        setLoading(true)
        const data = await getPricings({offset, limit, search});
        if ("error" in data) {
          setError(new Error(data.error));
        } else {
          setPricings(data);
        }
      } catch (error) {
        setError(error as Error);
      } finally {
        setLoading(false)
      }
    };
    makeRequest();
  }, [search, offset]);

  return { loading, error, pricings };
}
