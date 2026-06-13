import { useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { usePricingCollectionsApi } from '../../../profile/api/pricingCollectionsApi';
import CollectionsListView from '../../../core/components/collections-list-view';

export default function UserCollectionsListPage() {
  const { getPermissionBasedUserCollections } = usePricingCollectionsApi();

  const fetchCollections = useCallback(
    (filters: Record<string, string>) => getPermissionBasedUserCollections(filters),
    [getPermissionBasedUserCollections]
  );

  return (
    <>
      <Helmet>
        <title>SPHERE - My Collections</title>
      </Helmet>
      <CollectionsListView
        fetchCollections={fetchCollections}
        title="My Collections"
        subtitle="Collections you have access to."
      />
    </>
  );
}
