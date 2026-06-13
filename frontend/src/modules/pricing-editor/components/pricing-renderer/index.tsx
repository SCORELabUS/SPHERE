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

import AddOnElement from './components/addon-element';
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
              {Object.values(pricing.addOns).map(addOn => (
                <AddOnElement
                  addOn={addOn}
                  currency={resolvedCurrency}
                  key={addOn.name}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
