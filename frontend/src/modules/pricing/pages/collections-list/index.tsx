import { useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { usePricingCollectionsApi } from '../../../profile/api/pricingCollectionsApi';
import CollectionsListView from '../../../core/components/collections-list-view';

export default function CollectionsListPage() {
  const { getCollections } = usePricingCollectionsApi();

  const fetchCollections = useCallback(
    (filters: Record<string, string>) => getCollections(filters),
    [getCollections]
  );

  return (
    <>
      <Helmet>
        <title>SPHERE - Collections</title>
      </Helmet>
      <CollectionsListView
        fetchCollections={fetchCollections}
        title="Collections"
        subtitle="Browse curated groups of pricing configurations."
      />
    </>
  );
}
