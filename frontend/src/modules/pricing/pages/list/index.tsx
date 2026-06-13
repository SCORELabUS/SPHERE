import { Helmet } from 'react-helmet-async';
import { usePricingsApi } from '../../api/pricingsApi';
import PricingListView from '../../../core/components/pricing-list-view';

const ROWS = 4;
const COLS = 3;
const PER_PAGE = ROWS * COLS;

export default function PricingListPage() {
  const { getPricings } = usePricingsApi();

  return (
    <>
      <Helmet><title>SPHERE - Public Pricings</title></Helmet>
      <PricingListView
        fetchPricings={(filters) => getPricings(filters)}
        title="Public Pricings"
        subtitle="Browse all public pricing configurations in SPHERE."
        perPage={PER_PAGE}
      />
    </>
  );
}
