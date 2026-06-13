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

export interface SphereError {
  error: string;
}

export async function fetchPricingYaml(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Response status: ${response.status}`);
  }
  return await response.text();
}

export interface PricingVersionsResult {
  name: string;
  slug: string;
  collection: { id: string; name: string; slug: string } | null;
  versions: PricingVersion[];
}

export interface PricingVersion {
  id: string;
  version: string;
  private: boolean;
  collection: { id: string; name: string; slug: string } | null;
  createdAt: string;
  url: string;
  yaml: string;
  analytics: object;
  owner: {
    id: string;
    username: string;
  };
}
