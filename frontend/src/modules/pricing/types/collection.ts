export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string;
  organization: {
    id: string;
    name: string;
    displayName: string;
    avatar: string;
  };
  private: boolean;
  data: {
    pricings: any[];
    minPrice: CollectionDataStat;
    maxPrice: CollectionDataStat;
    configurationSpaceSize: CollectionDataStat;
  };
  analytics: CollectionAnalytics;
  numberOfPricings: number;
}

export interface CollectionAnalytics {
  evolutionOfPlans: ParameterEvolution;
  evolutionOfAddOns: ParameterEvolution;
  evolutionOfFeatures: ParameterEvolution;
  evolutionOfConfigurationSpaceSize: ParameterEvolution;
}

export interface ParameterEvolution {
  dates: string[];
  values: number[];
}

export interface CollectionDataStat {
  min: number;
  max: number;
  data: ParameterEvolution[];
}
