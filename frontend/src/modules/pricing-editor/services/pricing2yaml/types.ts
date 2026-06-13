export interface PricingDraft {
  saasName: string;
  syntaxVersion: string;
  version?: string;
  createdAt?: string;
  url?: string;
  tags?: string[];
  currency?: string;
  billing?: Record<string, number>;
  variables?: Record<string, unknown>;
  features: Record<string, DraftFeature>;
  usageLimits?: Record<string, DraftUsageLimit> | null;
  plans: Record<string, DraftPlan>;
  addOns?: Record<string, DraftAddOn> | null;
  custom?: Record<string, unknown>;
}

export interface DraftFeature {
  description?: string;
  tag?: string;
  valueType: 'BOOLEAN' | 'TEXT' | 'NUMERIC';
  defaultValue: string | number | boolean;
  type: string;
  expression?: string;
  serverExpression?: string;
  integrationType?: string;
  automationType?: string;
  docUrl?: string;
  pricingUrls?: string[];
  render?: string;
}

export interface DraftUsageLimit {
  description?: string;
  valueType: 'BOOLEAN' | 'TEXT' | 'NUMERIC';
  defaultValue: string | number | boolean;
  unit: string;
  type: 'RENEWABLE' | 'NON_RENEWABLE';
  trackable?: boolean;
  period?: { value: number; unit: string };
  linkedFeatures?: string[];
  render?: string;
}

export interface DraftPlan {
  description?: string;
  price: number | string;
  unit?: string;
  private?: boolean;
  features?: Record<string, { value: string | number | boolean }> | null;
  usageLimits?: Record<string, { value: string | number | boolean }> | null;
}

export interface DraftAddOn {
  description?: string;
  price: number | string;
  unit?: string;
  availableFor?: string[];
  dependsOn?: string[];
  excludes?: string[];
  private?: boolean;
  subscriptionConstraints?: { min: number; max: number; step: number };
  features?: Record<string, { value: string | number | boolean }>;
  usageLimits?: Record<string, { value: string | number | boolean }>;
  usageLimitsExtensions?: Record<string, { value: string | number | boolean }>;
}
