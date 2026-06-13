import { Pricing } from "pricing4ts";
import { AnalyticsDataEntry } from "../../../../assets/data/analytics";
import { formatDistanceToNow, parseISO } from 'date-fns';

const CURRENCIES: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹',
};

interface StatsProps {
    currentPricing: AnalyticsDataEntry;
    pricing: Pricing;
}

export const getCurrency = (currency: string) => {
    const parsedCurrency = currency as keyof typeof CURRENCIES;
    return currency in CURRENCIES ? CURRENCIES[parsedCurrency] : CURRENCIES['USD'];
};

export default function Stats({ currentPricing, pricing } : StatsProps) {
    return (
        <>
              <div className="flex items-center justify-between">
                  <h3 className="mb-2 text-xl font-semibold">
                      Stats
                  </h3>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex flex-col items-center justify-center text-center">
                        {currentPricing && formatDistanceToNow(parseISO(currentPricing.createdAt))} ago
                      <p className="text-sm text-slate-500">
                          last updated
                      </p>
                  </div>
                  <div className="flex flex-col items-center justify-center text-center">
                      <p>
                          {currentPricing?.analytics.configurationSpaceSize}
                      </p>
                      <p className="text-sm text-slate-500">
                          possible subscriptions
                      </p>
                  </div>
                  <div className="flex flex-col items-center justify-center text-center">
                      <p>
                          Min {currentPricing?.analytics.minSubscriptionPrice}{pricing?getCurrency(pricing.currency):''} - Max {currentPricing?.analytics.maxSubscriptionPrice}{pricing?getCurrency(pricing.currency):''}
                      </p>
                      <p className="text-sm text-slate-500">
                          monthly cost
                      </p>
                  </div>
              </div>
            </>
    );
}