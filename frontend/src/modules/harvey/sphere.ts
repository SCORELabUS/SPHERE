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

function getPricingYamlRequestUrl(url: string) {
  const parsedUrl = new URL(url, window.location.origin);

  // The API may expose local static files without the frontend/API dev ports.
  // Keep same-host assets on the frontend origin so Vite can proxy `/static`.
  if (parsedUrl.hostname === window.location.hostname && parsedUrl.origin !== window.location.origin) {
    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  }

  return parsedUrl.toString();
}

export async function fetchPricingYaml(url: string) {
  const response = await fetch(getPricingYamlRequestUrl(url));
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
