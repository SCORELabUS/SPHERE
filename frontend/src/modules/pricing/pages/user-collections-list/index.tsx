import { Helmet } from 'react-helmet-async';
import { usePricingCollectionsApi } from '../../../profile/api/pricingCollectionsApi';
import CollectionsListView from '../../../core/components/collections-list-view';

export default function UserCollectionsListPage() {
  const { getPermissionBasedUserCollections } = usePricingCollectionsApi();

  return (
    <>
      <Helmet>
        <title>SPHERE - My Collections</title>
      </Helmet>
      <CollectionsListView
        fetchCollections={(filters) => getPermissionBasedUserCollections(filters)}
        title="My Collections"
        subtitle="Collections you have access to."
      />
    </>
  );
}
