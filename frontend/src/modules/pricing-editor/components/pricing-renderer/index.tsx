import { PricingProps } from './types.d';
import FeatureTableV2 from './components/FeatureTableV2';
// import PricingCard from './components/pricing-card';
const CURRENCIES = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  CHF: 'CHF',
  CNY: '¥',
  SEK: 'kr',
  NZD: 'NZ$',
};

import { AddOnCard } from '../visual-editor/components/AddOnCard';
import { useState } from 'react';
import VariablesEditor from './components/VariablesEditor';

export function PricingRenderer({
  pricing,
  onApplyVariables,
}: Readonly<PricingProps>): JSX.Element {
  const [variablesModalOpen, setVariablesModalOpen] = useState(false);

  const resolvedCurrency =
    pricing.currency in CURRENCIES
      ? CURRENCIES[pricing.currency as keyof typeof CURRENCIES]
      : pricing.currency;

  return (
    <section className="py-6 sm:py-8">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* <PricingCard pricing={pricing} /> */}

        {Object.keys(pricing.variables).length > 0 && (
          <>
            <div className="mb-2 mt-4 flex justify-end">
              <button
                type="button"
                className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-sm font-semibold text-tp-charcoal transition-colors hover:bg-tp-surface"
                onClick={() => setVariablesModalOpen(true)}
              >
                Open variables simulator
              </button>
            </div>
            <VariablesEditor
              open={variablesModalOpen}
              onClose={() => setVariablesModalOpen(false)}
              variables={pricing.variables}
              onApply={variables => {
                if (onApplyVariables) onApplyVariables(variables);
              }}
            />
          </>
        )}

        <FeatureTableV2
          plans={pricing.plans ?? {}}
          features={pricing.features ?? {}}
          usageLimits={pricing.usageLimits ?? {}}
          addOns={pricing.addOns ?? {}}
          currency={resolvedCurrency}
        />

        {pricing.addOns && Object.values(pricing.addOns).length > 0 && (
          <div className="mt-12 sm:mt-16">
            <h2 className="mb-6 text-center text-3xl font-extrabold tracking-tight text-tp-ink sm:text-4xl lg:text-5xl">
              Add-Ons
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(() => {
                const publicPlanKeys = Object.entries(pricing.plans ?? {})
                  .filter(([, p]) => !p.private)
                  .map(([k]) => k);
                const publicPlanIndexMap = Object.fromEntries(publicPlanKeys.map((pk, i) => [pk, i]));
                return Object.entries(pricing.addOns).map(([key, addOn]) => (
                  <AddOnCard
                    key={key}
                    addOnKey={key}
                    addOn={{
                      description: addOn.description,
                      price: addOn.price,
                      unit: addOn.unit,
                      availableFor: addOn.availableFor?.filter(pk => publicPlanKeys.includes(pk)),
                      features: Object.fromEntries(
                        Object.entries(addOn.features ?? {}).map(([fk, f]) => [fk, { value: (f.value as string | number | boolean) ?? false }])
                      ),
                      usageLimits: Object.fromEntries(
                        Object.entries(addOn.usageLimits ?? {}).map(([uk, u]) => [uk, { value: (u.value as string | number | boolean) ?? 0 }])
                      ),
                      usageLimitsExtensions: Object.fromEntries(
                        Object.entries(addOn.usageLimitsExtensions ?? {}).map(([ek, u]) => [ek, { value: (u.value as string | number | boolean) ?? 0 }])
                      ),
                      dependsOn: addOn.dependsOn,
                      excludes: addOn.excludes,
                      private: addOn.private,
                    }}
                    planKeys={publicPlanKeys}
                    planIndexMap={publicPlanIndexMap}
                    currency={resolvedCurrency}
                    editable={false}
                    featureMap={Object.fromEntries(
                      Object.entries(pricing.features ?? {}).map(([fk, f]) => [fk, { valueType: f.valueType, defaultValue: f.defaultValue }])
                    )}
                    usageLimitMap={Object.fromEntries(
                      Object.entries(pricing.usageLimits ?? {}).map(([uk, u]) => [uk, { valueType: u.valueType, defaultValue: u.defaultValue }])
                    )}
                  />
                ));
              })()}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
