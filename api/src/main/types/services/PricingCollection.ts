export type CollectionIndexQueryParams = {
  name?: string;
  sortBy?: string;
  sort?: string;
  organizationIds?: string[];
  limit: number;
  offset: number;
}