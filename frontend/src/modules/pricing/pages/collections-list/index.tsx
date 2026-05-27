import { Helmet } from 'react-helmet-async';
import { usePricingCollectionsApi } from '../../../profile/api/pricingCollectionsApi';
import CollectionsListView from '../../../core/components/collections-list-view';

export default function CollectionsListPage() {
  const { getCollections } = usePricingCollectionsApi();

  return (
    <>
      <Helmet>
        <title>SPHERE - Collections</title>
      </Helmet>
      <CollectionsListView
        fetchCollections={(filters) => getCollections(filters)}
        title="Collections"
        subtitle="Browse curated groups of pricing configurations."
      />
    </>
  );
}
