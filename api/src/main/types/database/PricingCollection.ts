export interface PricingCollection {
    name: string,
    organization: Organization,
    analytics: PricingCollectionAnalytics
}

export interface RetrievedCollection {
  id: string,  
  slug: string,
  name: string,
    organization: {
        id: string,
        name: string,
        displayName: string,
        avatar: string
    },
    pricings: any,
    analytics: PricingCollectionAnalytics
}

interface Organization {
    id: string,
    name: string,
    displayName: string,
    avatar: string
}

export interface PricingCollectionAnalytics {
    evolutionOfPlans: ParameterEvolution,
    evolutionOfAddOns: ParameterEvolution,
    evolutionOfFeatures: ParameterEvolution,
    evolutionOfConfigurationSpaceSize: ParameterEvolution,
}

export type PricingCollectionAnalyticsToAdd = Record<string, AnalyticsParameter>

// export interface PricingCollectionAnalyticsToAdd {
//     evolutionOfPlans: AnalyticsParameter,
//     evolutionOfAddOns: AnalyticsParameter,
//     evolutionOfFeatures: AnalyticsParameter,
//     evolutionOfConfigurationSpaceSize: AnalyticsParameter,
// }

export interface ParameterEvolution {
    dates: Date[],
    values: number[]
}

export interface AnalyticsParameter {
    date: Date,
    value: number
}