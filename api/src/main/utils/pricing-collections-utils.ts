import { Pricing } from "../types/database/Pricing";

/**
 * The pricing versions whose analytics were stored. A version can lack them when
 * computing or saving its analytics failed, and it must not break its collection.
 */
export const withAnalytics = <T extends { analytics?: unknown }>(pricings: T[]): T[] =>
  pricings.filter(pricing => pricing.analytics && typeof pricing.analytics === 'object');

export const calculateAnalyticsForPricings = (allPricings: any) => {
  const pricings: any[] = withAnalytics(allPricings ?? []);
  if (pricings.length === 0) {
    const empty = () => ({ dates: [], values: [] });
    return {
      evolutionOfPlans: empty(),
      evolutionOfAddOns: empty(),
      evolutionOfFeatures: empty(),
      evolutionOfConfigurationSpaceSize: empty(),
    };
  }

  const extractionDates = _simulateCollectionEvolution(pricings);

  const analyticsByMonth = _getAnalyticsEvolution(extractionDates);

  return {
    evolutionOfPlans: {
      dates: Object.keys(analyticsByMonth),
      values: Object.values(analyticsByMonth).map(analytics => analytics.avgPlans),
    },
    evolutionOfAddOns: {
      dates: Object.keys(analyticsByMonth),
      values: Object.values(analyticsByMonth).map(analytics => analytics.avgAddOns),
    },
    evolutionOfFeatures: {
      dates: Object.keys(analyticsByMonth),
      values: Object.values(analyticsByMonth).map(analytics => analytics.avgFeatures),
    },
    evolutionOfConfigurationSpaceSize: {
      dates: Object.keys(analyticsByMonth),
      values: Object.values(analyticsByMonth).map(
        analytics => analytics.avgConfigurationSpaceSize
      ),
    },
  };
};

function _simulateCollectionEvolution(pricings: Pricing[]) {
  const pricingsByDate: Record<string, any[]> = {};

  const extractionDates = pricings.map((pricing: any) => new Date(pricing.createdAt));
  const minDate = new Date(Math.min(...extractionDates.map(date => date.getTime())));
  const maxDate = new Date(Math.max(...extractionDates.map(date => date.getTime())));
  maxDate.setMonth(maxDate.getMonth() + 12); // Added four months to include the pricing with the las extraction date and stabilise the analytics

  for (let date = new Date(minDate); date <= maxDate; date.setMonth(date.getMonth() + 12)) {
    const isoDate = date.toISOString().split('T')[0];
    const filteredPricings = pricings.filter(
      (pricing: any) => new Date(pricing.createdAt) <= date
    );

    const latestPricings: Record<string, any> = {};

    // If many versions of the same pricing pass the filter, select the most recent version
    for (const pricing of filteredPricings) {
      if (
        !latestPricings[pricing.name] ||
        new Date(pricing.createdAt) > new Date(latestPricings[pricing.name].createdAt)
      ) {
        latestPricings[pricing.name] = pricing;
      }
    }

    pricingsByDate[isoDate] = Object.values(latestPricings);
  }

  return pricingsByDate;
}

// A metric missing from a version's analytics counts as 0 instead of turning the average into NaN.
export function analyticsMetric(pricing: any, key: string): number {
  const value = pricing.analytics?.[key];
  return Number.isFinite(value) ? value : 0;
}

function _getAnalyticsEvolution(extractionDates: Record<string, any>) {
  const analyticsEvolution: Record<
    string,
    { avgPlans: number; avgAddOns: number; avgFeatures: number; avgConfigurationSpaceSize: number }
  > = {};

  for (const date in extractionDates) {
    const pricings = extractionDates[date];
    
    analyticsEvolution[date] = {
      avgPlans:
        pricings.reduce((acc: number, pricing: any) => acc + analyticsMetric(pricing, 'numberOfPlans'), 0) /
        pricings.length,
      avgAddOns:
        pricings.reduce((acc: number, pricing: any) => acc + analyticsMetric(pricing, 'numberOfAddOns'), 0) /
        pricings.length,
      avgFeatures:
        pricings.reduce(
          (acc: number, pricing: any) => acc + analyticsMetric(pricing, 'numberOfFeatures'),
          0
        ) / pricings.length,
      avgConfigurationSpaceSize:
        pricings.reduce(
          (acc: number, pricing: any) => acc + analyticsMetric(pricing, 'configurationSpaceSize'),
          0
        ) / pricings.length,
    };
  }

  return analyticsEvolution;
}
