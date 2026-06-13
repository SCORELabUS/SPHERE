import { Helmet } from 'react-helmet-async';
import { usePricingsApi } from '../../api/pricingsApi';
import PricingListView from '../../../core/components/pricing-list-view';

const ROWS = 4;
const COLS = 3;
const PER_PAGE = ROWS * COLS;

export default function UserPricingListPage() {
  const { getPermissionBasedUserPricings } = usePricingsApi();

  return (
    <>
      <Helmet><title>SPHERE - My Pricings</title></Helmet>
      <PricingListView
        fetchPricings={(filters) => getPermissionBasedUserPricings(filters)}
        title="My Pricings"
        subtitle="Pricing you have access to."
        perPage={PER_PAGE}
      />
    </>
  );
}
