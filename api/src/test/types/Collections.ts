export type TestCollection = {
  id: string;
  name: string;
  slug: string;
  description: string;
  _organizationId: string;
  private: boolean;
  analytics: {
    evolutionOfPlans: ParameterEvolutionSchema,
    evolutionOfAddOns: ParameterEvolutionSchema,
    evolutionOfFeatures: ParameterEvolutionSchema,
    evolutionOfConfigurationSpaceSize: ParameterEvolutionSchema,
  };
}

export type ParameterEvolutionSchema = {
  dates: Date[],
  values: number[],
}