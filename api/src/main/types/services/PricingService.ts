export type PricingIndexQueryParams = {
  name?: string;
  sortBy?: SortByType;
  sort?: 'asc' | 'desc';
  subscriptions?: {
    min: number;
    max: number;
  };
  minPrice?: {
    min: number;
    max: number;
  };
  maxPrice?: {
    min: number;
    max: number;
  };
  selectedOrganizations?: string[];
  collection?: string;
  excludePricingsInCollection?: boolean;
  limit: number;
  offset: number;
}

export type SortByType = 'name' | 'configurationSpaceSize' | 'featuresCount' | 'usageLimitsCount' | 'plansCount' | 'addonsCount' | 'minPrice' | 'maxPrice' | ''
