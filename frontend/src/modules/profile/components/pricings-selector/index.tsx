// MultiSelectCards.tsx
import { useEffect, useState } from 'react';
import SelectablePricingCard from '../selectable-pricing-card';
import { useOrganizationsApi } from '../../../organization/api/organizationsApi';

type MultiSelectCardsProps = {
  readonly organizationId: string | null;
  readonly value: string[];
  readonly onChange: (selectedSlugs: string[]) => void;
};

type SelectablePricing = { name: string; slug: string };

// Collections only take pricings of their own organization that are not in a collection yet.
const UNASSIGNED_PRICINGS_FILTERS = { excludePricingsInCollection: 'true', limit: '500' };

export default function PricingSelector({ organizationId, value, onChange }: MultiSelectCardsProps) {
  const [pricings, setPricings] = useState<SelectablePricing[]>([]);

  const { getOrgPricings } = useOrganizationsApi();

  const handleCardClick = (slug: string) => {
    let newSelected: string[];
    if (value.includes(slug)) {
      newSelected = value.filter(item => item !== slug);
    } else {
      newSelected = [...value, slug];
    }

    onChange(newSelected);
  };

  useEffect(() => {
    setPricings([]);
    if (!organizationId) return;

    const controller = new AbortController();
    getOrgPricings(organizationId, UNASSIGNED_PRICINGS_FILTERS, controller.signal)
      .then(data => {
        setPricings(data.pricings.map(pricing => ({ name: pricing.name, slug: pricing.slug })));
      })
      .catch(error => {
        if (!controller.signal.aborted) console.error('Cannot GET pricings. Error:', error);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  if (!organizationId) return <></>;

  return pricings.length > 0 ? (
    <div className="grid grid-cols-1 gap-2 rounded-2xl border border-[#ccc] p-2 md:grid-cols-2 lg:grid-cols-3">
      {pricings.map(pricing => (
        <div key={pricing.slug}>
          <SelectablePricingCard
            name={pricing.name}
            selected={value.includes(pricing.slug)}
            onClick={() => handleCardClick(pricing.slug)}
          />
        </div>
      ))}
    </div>
  ) : (
    <p className="py-2 text-sm text-tp-steel">This organization has no pricings without a collection.</p>
  );
}
