import { useCallback, useMemo, useState } from 'react';
import {
  addRecentPricing as addRecentPricingUtil,
  addRecentCollection as addRecentCollectionUtil,
  addRecentOrganization as addRecentOrganizationUtil,
  getRecentPricings as getRecentPricingsUtil,
  getRecentCollections as getRecentCollectionsUtil,
  getRecentOrganizations as getRecentOrganizationsUtil,
  type RecentItem,
} from '../utils/recentItems';

export type { RecentItem };

export function useRecentItems() {
  const [recentPricings, setRecentPricings] = useState<RecentItem[]>(() => getRecentPricingsUtil());
  const [recentCollections, setRecentCollections] = useState<RecentItem[]>(() => getRecentCollectionsUtil());
  const [recentOrganizations, setRecentOrganizations] = useState<RecentItem[]>(() => getRecentOrganizationsUtil());

  const addRecentPricing = useCallback((item: Omit<RecentItem, 'visitedAt'>) => {
    addRecentPricingUtil(item);
    setRecentPricings(getRecentPricingsUtil());
  }, []);

  const addRecentCollection = useCallback((item: Omit<RecentItem, 'visitedAt'>) => {
    addRecentCollectionUtil(item);
    setRecentCollections(getRecentCollectionsUtil());
  }, []);

  const addRecentOrganization = useCallback((item: Omit<RecentItem, 'visitedAt'>) => {
    addRecentOrganizationUtil(item);
    setRecentOrganizations(getRecentOrganizationsUtil());
  }, []);

  return useMemo(() => ({
    recentPricings,
    recentCollections,
    recentOrganizations,
    addRecentPricing,
    addRecentCollection,
    addRecentOrganization,
  }), [recentPricings, recentCollections, recentOrganizations, addRecentPricing, addRecentCollection, addRecentOrganization]);
}
